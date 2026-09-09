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

export type ScreenTime = {
  usedMinutes: number;
  capMinutes: number | null;
  remainingMinutes: number | null;
  exhausted: boolean;
};

export type Child = {
  id: string;
  parentUserId: string;
  name: string;
  age: number;
  dailyCapMinutes: number | null;
  allowedBookSlugs: string[];
  blockedBookSlugs: string[];
  approvedOnly: boolean;
  avatar: "fox" | "owl" | "whale" | "robot";
  createdAt: string;
};

export type ChildSummary = Child & { screenTime: ScreenTime; weekMinutes: number };

export type WeeklyReport = {
  days: { day: string; minutes: number }[];
  totalMinutes: number;
  titles: { editionId: string; title: string; bookSlug: string; minutes: number }[];
};

export type KidsShelf = {
  child: { id: string; name: string; age: number; avatar: Child["avatar"] };
  screenTime: ScreenTime;
  resume: KidsShelfItem | null;
  items: KidsShelfItem[];
  presetQuestions: string[];
  policy: {
    adsAllowed: boolean;
    freeTextAssistant: boolean;
    notifiesChildDevice: boolean;
  };
};

export type KidsShelfItem = {
  bookSlug: string;
  title: string;
  editionId: string;
  durationSec: number;
  positionSec: number;
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

/* ── Kids ──────────────────────────────────────────────────────────────——
   The child's own calls carry `X-Profile-Id`. The spec asks for that header on
   every request so the backend can apply the kids policy independently of the
   client — which is only worth anything if the client actually sends it, so it
   is set here rather than at each call site.                                  */

export const PROFILE_HEADER = "X-Profile-Id";

export const listChildren = () => call<{ children: ChildSummary[] }>("/me/children");

export const getChild = (id: string) =>
  call<{
    child: Child;
    screenTime: ScreenTime;
    report: WeeklyReport;
    shelf: { slug: string; title: string }[];
  }>(`/me/children/${encodeURIComponent(id)}`);

export const createChild = (input: {
  name: string;
  age: number;
  dailyCapMinutes: number | null;
  avatar: Child["avatar"];
}) =>
  call<{ child: Child }>("/me/children", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateChild = (id: string, patch: Record<string, unknown>) =>
  call<{ child: Child; screenTime: ScreenTime }>(
    `/me/children/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );

export const deleteChild = (id: string) =>
  call<{ ok: boolean }>(`/me/children/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const getKidsShelf = (profileId: string) =>
  call<KidsShelf>("/kids/shelf", { headers: { [PROFILE_HEADER]: profileId } });

export const reportListening = (
  profileId: string,
  editionId: string,
  seconds: number,
) =>
  call<{ screenTime: ScreenTime }>("/kids/listening", {
    method: "POST",
    headers: { [PROFILE_HEADER]: profileId },
    body: JSON.stringify({ editionId, seconds }),
  });

export const unlockKids = (pin: string) =>
  call<{ ok: boolean }>("/kids/unlock", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });

/* ── کتاب‌یار ──────────────────────────────────────────────────────────— */

export type Citation = { startSec: number; endSec: number; text: string };

export type AssistantAnswer = {
  text: string;
  citations: Citation[];
  grounded: boolean;
  provider: string;
  context: { heardCues: number; upToSec: number };
};

export type Recap = {
  bookTitle: string;
  chaptersDone: number;
  chaptersTotal: number;
  currentChapter: string | null;
  percent: number;
  openingLine: string | null;
  lastLine: string | null;
  publicSummary: string;
} | null;

export type QuizItem = {
  id: string;
  prompt: string;
  options: string[];
  answer: string;
  atSec: number;
};

export const askAssistant = (input: {
  editionId: string;
  chapterId: number | null;
  currentTimeSec: number;
  question: string;
  profileId?: string;
}) =>
  call<AssistantAnswer>("/assistant/ask", {
    method: "POST",
    headers: input.profileId ? { [PROFILE_HEADER]: input.profileId } : undefined,
    body: JSON.stringify(input),
  });

export const getRecap = (editionId: string, upToSec: number) =>
  call<{ recap: Recap; quiz: QuizItem[] }>(
    `/assistant/recap?editionId=${encodeURIComponent(editionId)}&upToSec=${Math.round(upToSec)}`,
  );

export type SemanticHit = {
  slug: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  summary: string;
  priceRial: number;
  score: number;
};

export const semanticSearch = (q: string) =>
  call<{ query: string; results: SemanticHit[]; engine: string }>(
    `/search/semantic?q=${encodeURIComponent(q)}`,
  );

/* ── Growth ────────────────────────────────────────────────────────────—
   Every field below is a conclusion the server reached. There is deliberately
   no threshold table on this side to compare against.                       */

export type Progress = {
  totalMinutes: number;
  streak: { current: number; longest: number; activeToday: boolean };
  level: {
    index: number;
    title: string;
    nextTitle: string | null;
    progressToNext: number;
    minutesToNext: number;
  };
  badges: { id: string; title: string; hint: string; earned: boolean }[];
  history: { day: string; minutes: number }[];
  recap: { due: boolean; daysAway: number };
};

export const getProgress = () => call<Progress>("/me/progress");

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
