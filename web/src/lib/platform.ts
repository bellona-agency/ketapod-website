/**
 * Typed client for the platform API.
 *
 * The spec's web stack row splits the site in two: catalogue pages are SSG and
 * indexable, "صفحات کاربری CSR پشت احراز هویت". So the authenticated screens
 * fetch from the browser exactly as the Flutter app will fetch from a device —
 * same endpoints, same cookie-or-bearer session — and none of them are
 * server-rendered. That keeps the seam real: when the Go core replaces the mock
 * handlers, only `PLATFORM_BASE` moves.
 *
 * Everything here throws `ApiError` on a non-2xx so callers can branch on
 * `code` rather than parsing messages. The messages are already Persian and
 * come from the server, because the server is where the rule lives.
 */

export const PLATFORM_BASE =
  process.env.NEXT_PUBLIC_PLATFORM_BASE_URL?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PLATFORM_BASE}/api/v1${path}`, {
    ...init,
    /* The session is an httpOnly cookie; without this it is simply not sent,
       and every authenticated call 401s for no visible reason. */
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(body.error ?? "unknown"),
      String(body.message ?? "خطایی رخ داد."),
      body,
    );
  }
  return body as T;
}

/* ── Types the screens consume ───────────────────────────────────────────— */

export type Me = {
  id: string;
  phone: string;
  name: string | null;
  roles: string[];
  walletBalanceRial: number;
  entitlementCount: number;
  deviceCount: number;
};

export type LibraryItem = {
  entitlementId: string;
  source: "purchase" | "gift" | "subscription" | "org" | "promo";
  expiresAt: string | null;
  expired: boolean;
  editionId: string;
  bookSlug: string;
  title: string;
  narratorType: "human" | "ai";
  dialectSlug: string | null;
  durationSec: number;
  voice: { slug: string; name: string } | null;
  positionSec: number;
  progress: number;
  lastPlayedAt: string | null;
};

export type Chapter = {
  index: number;
  title: string;
  startSec: number;
  endSec: number;
};

export type Cue = { startSec: number; endSec: number; text: string };

export type Mark = {
  id: string;
  positionSec: number;
  label: string;
  createdAt: string;
};

export type EditionDetail = {
  editionId: string;
  bookSlug: string;
  title: string;
  narratorType: "human" | "ai";
  durationSec: number;
  voice: { slug: string; name: string; timbre: string } | null;
  audioUrl: string;
  chapters: Chapter[];
  transcript: Cue[];
  positionSec: number;
  bookmarks: Mark[];
  notes: { id: string; positionSec: number; body: string; createdAt: string }[];
};

export type LedgerEntry = {
  id: string;
  amountRial: number;
  kind: "topup" | "purchase" | "refund" | "gift_received" | "promo";
  memo: string;
  createdAt: string;
};

/* ── Calls ───────────────────────────────────────────────────────────────— */

export const requestOtp = (phone: string) =>
  call<{ phone: string; expiresInSec: number; delivery: string; code?: string }>(
    "/auth/otp/request",
    { method: "POST", body: JSON.stringify({ phone }) },
  );

export const verifyOtp = (phone: string, code: string) =>
  call<{ user: { id: string; phone: string; name?: string } }>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });

export const getMe = () => call<Me>("/me");

export const signOut = () => call<{ ok: true }>("/me", { method: "DELETE" });

export const getLibrary = () =>
  call<{ items: LibraryItem[]; continueListening: LibraryItem | null }>("/me/library");

export const getWallet = () =>
  call<{ balanceRial: number; entries: LedgerEntry[] }>("/me/wallet");

export const topUp = (amountRial: number) =>
  call<{ balanceRial: number }>("/me/wallet", {
    method: "POST",
    body: JSON.stringify({ amountRial }),
  });

export const getEdition = (editionId: string) =>
  call<EditionDetail>(`/editions/${encodeURIComponent(editionId)}`);

export const addBookmark = (editionId: string, positionSec: number, label?: string) =>
  call<{ bookmark: Mark; created: boolean }>("/me/bookmarks", {
    method: "POST",
    body: JSON.stringify({ editionId, positionSec, label, kind: "bookmark" }),
  });

export const addNote = (editionId: string, positionSec: number, body: string) =>
  call<{ note: { id: string } }>("/me/bookmarks", {
    method: "POST",
    body: JSON.stringify({ editionId, positionSec, body, kind: "note" }),
  });

export const buyEdition = (editionId: string) =>
  call<{ orderId: string; balanceRial: number }>("/orders", {
    method: "POST",
    body: JSON.stringify({ editionId }),
  });

/**
 * Write a playback position.
 *
 * `updatedAt` is the *device* clock, because the spec resolves sync conflicts
 * last-write-wins on device time. Sending it from here rather than stamping it
 * on the server is what lets a phone that was offline replay its queue without
 * overwriting a laptop that has since moved further into the book.
 */
export const putPosition = (editionId: string, positionSec: number) =>
  call<{ applied: boolean; position: { positionSec: number } }>("/me/positions", {
    method: "PUT",
    body: JSON.stringify({
      editionId,
      positionSec: Math.round(positionSec),
      updatedAt: new Date().toISOString(),
    }),
  });
