/**
 * Client for the content-production panel.
 *
 * The panel is the internal tool that feeds the AI pipeline: an editor
 * uploads a PDF and a cover, says whether it should be narrated and whether it
 * should join the Ketabyar assistant, and the Go core turns that into a work
 * item for the AI service, a row in the site's catalogue, and a dispatch job.
 *
 * The admin key is held in `sessionStorage`, not in the bundle. Putting it in
 * `NEXT_PUBLIC_*` would ship a credential that unlocks book uploads to every
 * visitor of the public site; typing it once per browser session keeps it with
 * the person who has it. It leaves the tab the moment the tab closes.
 */

import { API_BASE, API_PREFIX } from "./api";

const KEY_STORAGE = "kp_admin_key";

/**
 * The key, as an external store.
 *
 * `sessionStorage` is exactly what `useSyncExternalStore` is for: it exists
 * only on the client, it changes outside React, and reading it in an effect
 * would make the component render twice on every mount. `subscribe` carries
 * changes made in this tab — a second tab is a separate session and gets its
 * own prompt, which is the behaviour we want anyway.
 */
const listeners = new Set<() => void>();

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export const adminKey = {
  subscribe(onChange: () => void) {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
  get: readKey,
  /* On the server there is no session, so the gate is what renders. */
  getServerSnapshot: () => "",
  set(value: string) {
    try {
      sessionStorage.setItem(KEY_STORAGE, value);
    } catch {
      /* a locked-down browser just means the key is asked for again */
    }
    listeners.forEach((l) => l());
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      /* nothing to clean up */
    }
    listeners.forEach((l) => l());
  },
};

/* ── Types (mirror components/schemas/Ingestion in api/v1/openapi.yaml) ──── */

export type JobStep = {
  step: string;
  status: "pending" | "processing" | "completed" | "failed" | "skipped" | "cancelled";
  progress: number;
  attempt: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type Job = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  currentStep?: string;
  progress: number;
  error?: string;
  steps?: JobStep[];
};

export type Ingestion = {
  id: string;
  aiBookId: string;
  aiDocumentId: string;
  catalogBookId?: string;
  catalogSlug?: string;
  title: string;
  author?: string;
  description?: string;
  pdfFileName: string;
  pdfSizeBytes: number;
  coverUrl?: string;
  wantTts: boolean;
  wantAssistant: boolean;
  dispatchStatus: "pending" | "dispatched" | "failed";
  dispatchError?: string;
  dispatchedAt?: string;
  aiBookStatus?: "draft" | "processing" | "ready" | "failed";
  catalogEditionId?: string;
  audioStatus: "none" | "pending" | "synced" | "failed";
  audioError?: string;
  audioSyncedAt?: string;
  createdBy?: string;
  createdAt: string;
  job?: Job;
};

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/* ── Transport ───────────────────────────────────────────────────────────── */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = adminKey.get();

  const res = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(key ? { "X-Admin-Key": key } : {}),
      ...init.headers,
    },
    /* Uploads are books, not form posts — a scanned PDF on a slow link
       takes minutes and must not be cut short by a default. */
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    throw new AdminError("کلید ادمین پذیرفته نشد.", res.status);
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 422) {
    throw new AdminError(
      String(body.message ?? "اطلاعات ارسالی کامل نیست."),
      422,
      (body.errors as Record<string, string[]>) ?? {},
    );
  }
  if (!res.ok) {
    throw new AdminError(String(body.message ?? `خطای ${res.status}`), res.status);
  }

  return body as T;
}

export function listIngestions(limit = 50) {
  return request<{ items: Ingestion[]; total: number }>(`/admin/ingestions?limit=${limit}`);
}

export function getIngestion(id: string) {
  return request<Ingestion>(`/admin/ingestions/${id}`);
}

export function redispatchIngestion(id: string) {
  return request<Ingestion>(`/admin/ingestions/${id}/dispatch`, { method: "POST" });
}

/** Builds the catalogue's audio edition from whatever the TTS pipeline has
 *  produced. The scheduler does this every couple of minutes on its own; this
 *  is the "don't make me wait" button, and the one that shows the reason when
 *  it cannot be done yet. */
export function syncIngestionAudio(id: string) {
  return request<Ingestion>(`/admin/ingestions/${id}/sync-audio`, { method: "POST" });
}

export type NewIngestion = {
  title: string;
  author: string;
  description: string;
  pdf: File;
  cover: File | null;
  tts: boolean;
  assistant: boolean;
};

export function createIngestion(input: NewIngestion) {
  const form = new FormData();
  form.set("title", input.title);
  form.set("author", input.author);
  form.set("description", input.description);
  form.set("pdf", input.pdf);
  if (input.cover) form.set("cover", input.cover);
  /* The API reads "on"/"true"/"1"; sending the checkbox value verbatim keeps
     the panel working if it is ever replaced by a plain HTML form post. */
  form.set("tts", input.tts ? "on" : "off");
  form.set("assistant", input.assistant ? "on" : "off");

  return request<Ingestion>("/admin/ingestions", { method: "POST", body: form });
}

/* ── Display helpers ─────────────────────────────────────────────────────── */

export const DISPATCH_LABEL: Record<Ingestion["dispatchStatus"], string> = {
  pending: "در صف تحویل",
  dispatched: "تحویل شد",
  failed: "تحویل ناموفق",
};

export const AUDIO_LABEL: Record<Ingestion["audioStatus"], string> = {
  none: "بدون نسخه صوتی",
  pending: "در انتظار صدا",
  synced: "نسخه صوتی آماده",
  failed: "ساخت صدا ناموفق",
};

export const JOB_LABEL: Record<NonNullable<Ingestion["job"]>["status"], string> = {
  queued: "در صف",
  processing: "در حال پردازش",
  completed: "تمام شد",
  failed: "شکست خورد",
  cancelled: "لغو شد",
};

/** The AI pipeline's own step names, in Persian. Unknown steps pass through
 *  rather than being hidden — a step we do not know about is exactly the one
 *  worth seeing. */
export const STEP_LABEL: Record<string, string> = {
  document_detection: "تشخیص نوع سند",
  ocr: "OCR",
  text_processing: "پردازش متن",
  structure_detection: "تشخیص ساختار",
  summarization: "تولید خلاصه",
  tts: "تولید صوت",
  knowledge_indexing: "افزودن به کتاب‌یار",
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} کیلوبایت`;
  return `${(bytes / 1024 / 1024).toFixed(1)} مگابایت`;
}
