/**
 * Home page API client.
 *
 * Contracts follow design-web-v1.1-HomePage. Every dynamic section degrades on
 * its own: a failing endpoint returns the seeded fallback (the sample payload
 * from the document) instead of throwing, because the doc requires that no
 * section failure can cause a page-level failure.
 *
 * The Go core mounts *every* v1 route under one prefix (see
 * `backend/internal/platform/apiversion` and `cmd/api/main.go`), so the prefix
 * lives here once rather than being repeated — and the demo endpoints, which
 * the design document listed without it, are built from the same constant as
 * the rest. `API_BASE` is the host only; when a v2 arrives, `API_PREFIX` is the
 * single line that moves.
 */

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.ketapod.ir"
).replace(/\/+$/, "");

/** Matches `apiversion.V1.Prefix()` on the Go side. */
export const API_PREFIX = "/api/v1";

const v1 = (path: string) => `${API_PREFIX}${path}`;

export const ENDPOINTS = {
  stats: v1("/public/home/stats"),
  demo: v1("/public/home/demo"),
  audioItem: (bookId: string) => v1(`/public/home/audio-items/${encodeURIComponent(bookId)}`),
  localization: v1("/public/home/localization"),
  socialProof: v1("/public/home/social-proof"),
  leadOptions: v1("/public/leads/options"),
  leads: v1("/public/leads"),
  events: v1("/public/events"),
  kidsModePreference: v1("/me/preferences/kids-mode"),
} as const;

/**
 * Analytics is off unless a collector is actually wired.
 *
 * `/public/events` is in the design document but not in the Go core's route
 * table, so with it on by default every interaction fires a beacon at a 404.
 * Fire-and-forget hides that from the page, which is exactly why it needs an
 * explicit switch rather than a silent stream of failures.
 */
export const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";

/* ── Types ───────────────────────────────────────────────────────────────── */

export type Stat = {
  key: string;
  label: string;
  value: number;
  displayValue: string;
};

export type Voice = {
  id: string;
  name: string;
  style: "calm" | "dramatic" | "kids" | string;
  isDefault: boolean;
};

export type Recommendation = {
  id: string;
  bookId: string;
  title: string;
  coverUrl: string;
  tag: string;
  type: "ai" | "kids" | "local" | string;
};

export type SampleBook = {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  durationSeconds: number;
  currentProgressPercent: number;
  aiTag: string;
};

export type DemoData = {
  sampleBook: SampleBook;
  voices: Voice[];
  recommendations: Recommendation[];
  continueListening: {
    id: string;
    bookId: string;
    title: string;
    progressPercent: number;
    coverUrl: string;
  };
  uiHints: { kidsModeDefault: boolean; autoplayAnimation: boolean };
};

export type AudioSource = {
  voiceId: string;
  voiceName: string;
  audioUrl: string;
  isKidsRecommended: boolean;
};

export type AudioItem = {
  id: string;
  bookId: string;
  title: string;
  durationSeconds: number;
  coverUrl: string;
  sources: AudioSource[];
  isKidsFriendly: boolean;
};

export type LocalizationData = {
  title: string;
  subtitle: string;
  languages: { code: string; label: string }[];
  localTopics: string[];
  samples: { id: string; title: string; coverUrl: string; language: string }[];
};

export type SocialProofData = {
  stats: { label: string; value: string }[];
  testimonials: {
    id: string;
    name: string;
    role: string;
    message: string;
    avatarUrl: string;
  }[];
  /* `partners` is still in the endpoint's response. The page no longer shows a
     partners rail, so it isn't modelled here — extra keys in the payload are
     ignored, and the field can come back if the section does. */
};

export type Option = { value: string; label: string };

export type LeadOptions = {
  userTypes: Option[];
  ageRanges: Option[];
  interestTags: Option[];
  languages: Option[];
};

export type LeadPayload = {
  fullName: string;
  email?: string;
  phoneNumber?: string;
  userType: string;
  ageRange?: string;
  interestTags: string[];
  preferredLanguage?: string;
  consent: boolean;
  source: string;
  landingPath: string;
  referrer: string;
  utm: Record<string, string | undefined>;
};

export type LeadResult =
  | { status: "created"; leadId: string; message: string }
  | { status: "duplicate"; duplicateBy: string; message: string }
  | { status: "validation_error"; errors: Record<string, string[]>; message: string }
  | { status: "error"; message: string };

/* ── Transport ───────────────────────────────────────────────────────────── */

/**
 * `revalidate` is only meaningful on the server, where Next's data cache reads
 * it; in the browser the key is ignored. It is what lets the home page's four
 * section reads happen once per window across all visitors rather than once per
 * visitor per page view.
 */
export type ReadOpts = { signal?: AbortSignal; revalidate?: number };

async function getJson<T>(path: string, opts: ReadOpts = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal: opts.signal,
    headers: { Accept: "application/json" },
    ...(opts.revalidate === undefined ? {} : { next: { revalidate: opts.revalidate } }),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Resolves to the fallback rather than rejecting — section-level isolation. */
async function getOrFallback<T>(
  path: string,
  fallback: T,
  opts: ReadOpts = {},
): Promise<T> {
  try {
    return await getJson<T>(path, opts);
  } catch {
    return fallback;
  }
}

/* ── Fallback seeds (sample payloads from the spec) ──────────────────────── */

export const FALLBACK_STATS: Stat[] = [
  { key: "activeUsers", label: "کاربر", value: 20000, displayValue: "20K+" },
  { key: "books", label: "کتاب صوتی", value: 1200, displayValue: "1200+" },
  { key: "narrators", label: "گوینده", value: 18, displayValue: "18" },
  { key: "categories", label: "دسته محتوا", value: 45, displayValue: "45+" },
];

export const FALLBACK_DEMO: DemoData = {
  sampleBook: {
    id: "book-1",
    title: "ماجراجویی در جنگل",
    author: "نویسنده نمونه",
    coverUrl: "",
    durationSeconds: 1240,
    currentProgressPercent: 42,
    aiTag: "پیشنهاد هوشمند",
  },
  voices: [
    { id: "voice_narrator_fa_01", name: "آرام", style: "calm", isDefault: true },
    { id: "voice_narrator_fa_02", name: "نمایشی", style: "dramatic", isDefault: false },
    { id: "voice_narrator_fa_03", name: "کودک", style: "kids", isDefault: false },
  ],
  recommendations: [
    { id: "r1", bookId: "book-2", title: "قصه شب", coverUrl: "", tag: "AI Suggestion", type: "ai" },
    { id: "r2", bookId: "book-3", title: "ماجرای کوچک", coverUrl: "", tag: "Kids", type: "kids" },
    { id: "r3", bookId: "book-4", title: "افسانه محلی", coverUrl: "", tag: "Local", type: "local" },
  ],
  continueListening: {
    id: "c1",
    bookId: "book-5",
    title: "قصه‌های کوتاه",
    progressPercent: 68,
    coverUrl: "",
  },
  uiHints: { kidsModeDefault: false, autoplayAnimation: false },
};

/** Offline stand-in so the player has real sources to switch between. */
export const FALLBACK_AUDIO_ITEM: AudioItem = {
  id: "home-sample-001",
  bookId: "book-1",
  title: "ماجراجویی در جنگل",
  durationSeconds: 1240,
  coverUrl: "",
  sources: [
    {
      voiceId: "voice_narrator_fa_01",
      voiceName: "گوینده آرام",
      audioUrl: "",
      isKidsRecommended: false,
    },
    {
      voiceId: "voice_narrator_fa_02",
      voiceName: "گوینده نمایشی",
      audioUrl: "",
      isKidsRecommended: false,
    },
    {
      voiceId: "voice_narrator_fa_03",
      voiceName: "گوینده کودک",
      audioUrl: "",
      isKidsRecommended: true,
    },
  ],
  isKidsFriendly: true,
};

export const FALLBACK_LOCALIZATION: LocalizationData = {
  title: "برای زبان‌ها و فرهنگ‌های متنوع",
  subtitle: "محتوای بومی، زبان‌های مختلف و تجربه‌ای نزدیک‌تر به شنونده.",
  languages: [
    { code: "fa", label: "فارسی" },
    { code: "en", label: "English" },
    { code: "ar", label: "العربية" },
    { code: "ku", label: "کوردی" },
    { code: "tr", label: "Türkçe" },
  ],
  localTopics: [
    "قصه‌های محلی",
    "ادبیات کودک بومی",
    "فرهنگ عامه",
    "افسانه‌ها",
    "روایت‌های منطقه‌ای",
  ],
  samples: [
    { id: "s1", title: "افسانه‌های محلی", coverUrl: "", language: "fa" },
    { id: "s2", title: "Bedtime Stories", coverUrl: "", language: "en" },
    { id: "s3", title: "قصه‌های قومی", coverUrl: "", language: "ku" },
  ],
};

export const FALLBACK_SOCIAL_PROOF: SocialProofData = {
  /* Zeroed deliberately. These are the numbers the stats bar shows when
     `/home/social-proof` cannot be reached, and every one of them used to be an
     invented figure — 1200 books, 20K users — presented to the reader as fact.
     A fallback may be a placeholder; it may not be a claim. Real values come
     from the endpoint. */
  stats: [
    { label: "کتاب", value: "0" },
    { label: "صدا", value: "0" },
    { label: "کاربر", value: "0" },
    { label: "همکار", value: "0" },
  ],
  testimonials: [
    {
      id: "t1",
      name: "مریم",
      role: "مادر",
      message: "فرزندم با این تجربه بیشتر به شنیدن علاقه‌مند شده است.",
      avatarUrl: "",
    },
    {
      id: "t2",
      name: "رضا",
      role: "کاربر",
      message: "پیشنهادهای هوشمند واقعاً نزدیک به سلیقه من بودند.",
      avatarUrl: "",
    },
    {
      id: "t3",
      name: "سارا",
      role: "دانشجو",
      message: "بین راه دانشگاه گوش می‌دهم و انتخاب گوینده برایم فرق بزرگی ساخت.",
      avatarUrl: "",
    },
    {
      id: "t4",
      name: "امیر",
      role: "پدر",
      message: "حالت کودک باعث شد بدون نگرانی گوشی را دست بچه بدهم.",
      avatarUrl: "",
    },
  ],
};

export const FALLBACK_LEAD_OPTIONS: LeadOptions = {
  userTypes: [
    { value: "normal", label: "کاربر عادی" },
    { value: "parent", label: "والدین" },
    { value: "teen", label: "نوجوان" },
    { value: "publisher", label: "ناشر" },
    { value: "creator", label: "تولیدکننده محتوا" },
  ],
  ageRanges: [
    { value: "under-12", label: "زیر ۱۲ سال" },
    { value: "13-17", label: "۱۳ تا ۱۷" },
    { value: "18-24", label: "۱۸ تا ۲۴" },
    { value: "25-34", label: "۲۵ تا ۳۴" },
    { value: "35-44", label: "۳۵ تا ۴۴" },
    { value: "45-plus", label: "۴۵ سال به بالا" },
  ],
  interestTags: [
    { value: "story", label: "داستان" },
    { value: "kids", label: "کودک" },
    { value: "self-development", label: "توسعه فردی" },
    { value: "education", label: "آموزشی" },
    { value: "local", label: "محتوای بومی" },
    { value: "multilingual", label: "چندزبانه" },
  ],
  languages: [
    { value: "fa", label: "فارسی" },
    { value: "en", label: "English" },
    { value: "ar", label: "العربية" },
  ],
};

/* ── Readers ─────────────────────────────────────────────────────────────── */

/**
 * How long the server may serve a cached copy of each section's payload.
 *
 * These four are editorial content that changes on a human timescale, so a
 * fifteen-minute window costs nothing in freshness and takes the API off the
 * critical path of every page view.
 */
export const SECTION_REVALIDATE = 900;

export const getStats = (opts?: ReadOpts) =>
  getOrFallback<{ stats: Stat[] }>(
    ENDPOINTS.stats,
    { stats: FALLBACK_STATS },
    opts,
  ).then((r) => r.stats ?? FALLBACK_STATS);

export const getDemo = (opts?: ReadOpts) =>
  getOrFallback<DemoData>(ENDPOINTS.demo, FALLBACK_DEMO, opts);

export const getLocalization = (opts?: ReadOpts) =>
  getOrFallback<LocalizationData>(ENDPOINTS.localization, FALLBACK_LOCALIZATION, opts);

export const getSocialProof = (opts?: ReadOpts) =>
  getOrFallback<SocialProofData>(ENDPOINTS.socialProof, FALLBACK_SOCIAL_PROOF, opts);

export const getLeadOptions = (opts?: ReadOpts) =>
  getOrFallback<LeadOptions>(ENDPOINTS.leadOptions, FALLBACK_LEAD_OPTIONS, opts);

/**
 * Audio item lookup. Unlike the other readers this one *throws*, because the
 * spec requires the player to enter an explicit "unavailable" state (Play
 * disabled) when the audio item cannot be resolved — silently swapping in fake
 * sources would violate the Real Playback contract.
 */
export async function getAudioItem(
  bookId: string,
  opts?: ReadOpts,
): Promise<AudioItem> {
  return getJson<AudioItem>(ENDPOINTS.audioItem(bookId), opts);
}

/* ── Writers ─────────────────────────────────────────────────────────────── */

export async function submitLead(payload: LeadPayload): Promise<LeadResult> {
  try {
    const res = await fetch(`${API_BASE}${ENDPOINTS.leads}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 201) {
      return {
        status: "created",
        leadId: String(body.leadId ?? ""),
        message: String(body.message ?? ""),
      };
    }
    if (res.status === 409) {
      return {
        status: "duplicate",
        duplicateBy: String(body.duplicateBy ?? "email"),
        message: String(body.message ?? ""),
      };
    }
    if (res.status === 422) {
      return {
        status: "validation_error",
        errors: (body.errors as Record<string, string[]>) ?? {},
        message: String(body.message ?? ""),
      };
    }
    return { status: "error", message: String(body.message ?? "Unexpected error") };
  } catch {
    return { status: "error", message: "Network error" };
  }
}

/**
 * Analytics. Marked "not required for MVP" in the spec, so this is fire-and-
 * forget and never surfaces an error to the UI.
 */
export function trackEvent(
  eventName: string,
  section: string,
  element: string,
  metadata: Record<string, unknown> = {},
) {
  if (typeof window === "undefined" || !ANALYTICS_ENABLED) return;
  const payload = {
    eventName,
    /* The real path. This was the literal "home" back when there was only one
       page; left alone, every event fired from a book, kids or dialect page
       would report itself as a home-page event and the funnel would show all
       traffic converting from `/`. */
    page: window.location.pathname,
    section,
    element,
    metadata,
    userContext: {
      sessionId: sessionId(),
      anonymousId: anonymousId(),
      userAgent: navigator.userAgent,
    },
    utm: readUtm(),
    occurredAt: new Date().toISOString(),
  };
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    navigator.sendBeacon?.(`${API_BASE}${ENDPOINTS.events}`, blob);
  } catch {
    /* analytics must never break the page */
  }
}

/* ── Attribution helpers ─────────────────────────────────────────────────── */

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

export function readUtm(): Record<string, string | undefined> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(
    UTM_KEYS.map((k) => [k, params.get(`utm_${k}`) ?? undefined]).filter(
      ([, v]) => v !== undefined,
    ),
  );
}

function stored(key: string, prefix: string, store: Storage): string {
  const existing = store.getItem(key);
  if (existing) return existing;
  const id = `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
  store.setItem(key, id);
  return id;
}

const sessionId = () => {
  try {
    return stored("kp_session", "sess", sessionStorage);
  } catch {
    return "sess_unknown";
  }
};

const anonymousId = () => {
  try {
    return stored("kp_anon", "anon", localStorage);
  } catch {
    return "anon_unknown";
  }
};
