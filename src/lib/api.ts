/**
 * Home page API client.
 *
 * Contracts follow design-web-v1.1-HomePage. Every dynamic section degrades on
 * its own: a failing endpoint returns the seeded fallback (the sample payload
 * from the document) instead of throwing, because the doc requires that no
 * section failure can cause a page-level failure.
 *
 * NOTE: the document lists the demo endpoints without the `/api/v1` prefix that
 * the other endpoints carry. Both shapes are kept verbatim here so the fix, if
 * the backend normalises them, is a one-line change.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.ketapod.ir";

export const ENDPOINTS = {
  stats: "/api/v1/public/home/stats",
  demo: "/public/home/demo",
  audioItem: (bookId: string) => `/public/home/audio-items/${bookId}`,
  localization: "/api/v1/public/home/localization",
  socialProof: "/api/v1/public/home/social-proof",
  leadOptions: "/api/v1/public/leads/options",
  leads: "/api/v1/public/leads",
  events: "/api/v1/public/events",
  kidsModePreference: "/api/v1/me/preferences/kids-mode",
} as const;

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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Resolves to the fallback rather than rejecting — section-level isolation. */
async function getOrFallback<T>(
  path: string,
  fallback: T,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await getJson<T>(path, signal);
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
  stats: [
    { label: "کتاب", value: "1200+" },
    { label: "صدا", value: "18" },
    { label: "کاربر", value: "20K+" },
    { label: "همکار", value: "24" },
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

export const getStats = (signal?: AbortSignal) =>
  getOrFallback<{ stats: Stat[] }>(
    ENDPOINTS.stats,
    { stats: FALLBACK_STATS },
    signal,
  ).then((r) => r.stats ?? FALLBACK_STATS);

export const getDemo = (signal?: AbortSignal) =>
  getOrFallback<DemoData>(ENDPOINTS.demo, FALLBACK_DEMO, signal);

export const getLocalization = (signal?: AbortSignal) =>
  getOrFallback<LocalizationData>(ENDPOINTS.localization, FALLBACK_LOCALIZATION, signal);

export const getSocialProof = (signal?: AbortSignal) =>
  getOrFallback<SocialProofData>(ENDPOINTS.socialProof, FALLBACK_SOCIAL_PROOF, signal);

export const getLeadOptions = (signal?: AbortSignal) =>
  getOrFallback<LeadOptions>(ENDPOINTS.leadOptions, FALLBACK_LEAD_OPTIONS, signal);

/**
 * Audio item lookup. Unlike the other readers this one *throws*, because the
 * spec requires the player to enter an explicit "unavailable" state (Play
 * disabled) when the audio item cannot be resolved — silently swapping in fake
 * sources would violate the Real Playback contract.
 */
export async function getAudioItem(
  bookId: string,
  signal?: AbortSignal,
): Promise<AudioItem> {
  return getJson<AudioItem>(ENDPOINTS.audioItem(bookId), signal);
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
  if (typeof window === "undefined") return;
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
