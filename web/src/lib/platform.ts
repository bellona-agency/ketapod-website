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

export type SubscriptionTier = "basic" | "plus" | "family";

export type Me = {
  id: string;
  phone: string;
  name: string | null;
  roles: string[];
  createdAt: string;
  referralCode: string;
  walletBalanceRial: number;
  entitlementCount: number;
  deviceCount: number;
  unreadNotifications: number;
  subscription: {
    tier: SubscriptionTier;
    tierName: string;
    status: "active" | "cancelled" | "expired";
    currentPeriodEnd: string;
    daysLeft: number;
  } | null;
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

export const verifyOtp = (phone: string, code: string, referralCode?: string) =>
  call<{ user: { id: string; phone: string; name?: string }; isNewAccount: boolean }>(
    "/auth/otp/verify",
    { method: "POST", body: JSON.stringify({ phone, code, referralCode }) },
  );

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

/* ── The account panel ───────────────────────────────────────────────────—
   Everything below backs `/account/*`. It is a thin layer on purpose: not one
   of these functions decides anything. Prices, caps, refund eligibility and
   plan coverage all arrive already computed, because the moment a screen works
   one of them out for itself there are two versions of the rule and the Flutter
   app will shortly add a third.                                             */

export const updateProfile = (name: string) =>
  call<{ id: string; name: string | null }>("/me", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export type Prefs = {
  playbackRate: number;
  skipForwardSec: number;
  skipBackSec: number;
  autoplayNextChapter: boolean;
  preferredNarrator: "human" | "ai" | "any";
  preferredDialect: string | null;
  notify: { renewal: boolean; kidsActivity: boolean; recap: boolean; newRelease: boolean };
};

export const getPrefs = () => call<{ prefs: Prefs }>("/me/prefs");

export const savePrefs = (patch: Partial<Prefs>) =>
  call<{ prefs: Prefs }>("/me/prefs", { method: "PATCH", body: JSON.stringify(patch) });

export type DeviceRow = {
  id: string;
  label: string;
  lastSeenAt: string;
  current: boolean;
};

export const getDevices = () =>
  call<{
    devices: DeviceRow[];
    concurrentCap: number;
    capSource: string;
    upgradeTo: { id: SubscriptionTier; name: string; concurrentDevices: number }[];
  }>("/me/devices");

export const revokeDevice = (id: string) =>
  call<{ ok: boolean; revokedSelf: boolean }>(
    `/me/devices?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

export type Tier = {
  id: SubscriptionTier;
  name: string;
  monthlyRial: number;
  concurrentDevices: number;
  childProfiles: number;
  perks: string[];
};

export type SubscriptionState = {
  subscription:
    | {
        id: string;
        tier: SubscriptionTier;
        tierName: string;
        status: "active" | "cancelled" | "expired";
        startedAt: string;
        currentPeriodEnd: string;
        cancelledAt: string | null;
        daysLeft: number;
      }
    | null;
  renewalDue: boolean;
  tiers: Tier[];
  balanceRial: number;
  history: LedgerEntry[];
};

export const getSubscription = () => call<SubscriptionState>("/me/subscription");

export const subscribe = (tier: SubscriptionTier) =>
  call<{ balanceRial: number }>("/me/subscription", {
    method: "POST",
    body: JSON.stringify({ tier }),
  });

export const cancelSubscription = () =>
  call<{ subscription: { currentPeriodEnd: string } }>("/me/subscription", {
    method: "DELETE",
  });

/**
 * Open a payment and get the URL to send the browser to.
 *
 * The caller navigates; it does not fetch the result. That is the whole point
 * of a gateway — the money is authorised somewhere this code cannot see, and
 * the answer arrives as a return trip rather than as a response to this call.
 */
export const openPayment = (input: {
  purpose: "topup" | "subscription";
  amountRial?: number;
  tier?: SubscriptionTier;
  returnPath?: string;
}) =>
  call<{ redirectUrl: string; intent: { id: string; amountRial: number } }>(
    "/payments/intents",
    { method: "POST", body: JSON.stringify(input) },
  );

export type PaymentIntentView = {
  id: string;
  amountRial: number;
  purpose: "topup" | "subscription";
  status: "pending" | "paid" | "failed" | "cancelled";
  gatewayRef: string;
  returnPath: string;
};

export const getPayment = (id: string) =>
  call<{ intent: PaymentIntentView; tierName: string | null }>(
    `/payments/intents/${encodeURIComponent(id)}`,
  );

export const settlePayment = (id: string, outcome: "paid" | "failed" | "cancelled") =>
  call<{ intent: PaymentIntentView; balanceRial: number; warning?: string }>(
    `/payments/intents/${encodeURIComponent(id)}`,
    { method: "POST", body: JSON.stringify({ outcome }) },
  );

export type OrderRow = {
  id: string;
  editionId: string;
  bookSlug: string | null;
  bookTitle: string;
  voiceName: string | null;
  priceRial: number;
  status: "paid" | "refunded";
  createdAt: string;
  progress: number;
  refundable: boolean;
  refundBlockedBecause: string | null;
};

export const getOrders = () =>
  call<{
    orders: OrderRow[];
    policy: { windowDays: number; maxProgressPercent: number };
  }>("/me/orders");

export const refundOrder = (orderId: string) =>
  call<{ balanceRial: number }>("/me/orders", {
    method: "POST",
    body: JSON.stringify({ orderId }),
  });

export type RedeemOk =
  | { kind: "credit"; amountRial: number; label: string; balanceRial: number }
  | { kind: "percent"; percent: number; label: string };

export const getPendingDiscount = () =>
  call<{ pending: { percent: number; code: string } | null }>("/me/redeem");

export const redeemCode = (code: string) =>
  call<RedeemOk>("/me/redeem", { method: "POST", body: JSON.stringify({ code }) });

export type GiftRow = {
  id: string;
  code: string;
  bookTitle: string;
  bookSlug: string | null;
  toPhone: string | null;
  message: string;
  priceRial: number;
  claimedAt: string | null;
  createdAt: string;
  claimPath: string;
};

export const getGifts = () =>
  call<{ sent: GiftRow[]; received: GiftRow[] }>("/me/gifts");

export const sendGift = (input: {
  editionId: string;
  toPhone?: string;
  message?: string;
}) =>
  call<{ gift: { code: string }; bookTitle: string; claimPath: string }>("/me/gifts", {
    method: "POST",
    body: JSON.stringify(input),
  });

export type GiftPreview = {
  gift: {
    code: string;
    fromName: string;
    message: string;
    claimed: boolean;
    reserved: boolean;
  };
  book: {
    slug: string;
    title: string;
    author: string | null;
    durationSec: number;
    voiceName: string | null;
  } | null;
};

export const previewGift = (code: string) =>
  call<GiftPreview>(`/gifts/${encodeURIComponent(code)}`);

export const claimGift = (code: string) =>
  call<{ ok: true; bookTitle: string | null }>(`/gifts/${encodeURIComponent(code)}`, {
    method: "POST",
  });

export type FavouriteItem = {
  bookSlug: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  editionCount: number;
  fromRial: number;
  owned: boolean;
  addedAt: string;
};

export const getFavourites = () =>
  call<{ items: FavouriteItem[]; slugs: string[] }>("/me/favourites");

export const addFavourite = (bookSlug: string) =>
  call<{ created: boolean }>("/me/favourites", {
    method: "POST",
    body: JSON.stringify({ bookSlug }),
  });

export const removeFavourite = (bookSlug: string) =>
  call<{ ok: boolean }>(`/me/favourites?bookSlug=${encodeURIComponent(bookSlug)}`, {
    method: "DELETE",
  });

export type MarkRow = {
  id: string;
  editionId: string;
  bookSlug: string | null;
  bookTitle: string;
  voiceName: string | null;
  positionSec: number;
  createdAt: string;
  label?: string;
  body?: string;
  summary?: string | null;
  summaryState?: "none" | "pending" | "ready";
};

export const getMarks = () =>
  call<{ bookmarks: MarkRow[]; notes: MarkRow[] }>("/me/bookmarks");

export const deleteMark = (id: string) =>
  call<{ ok: boolean }>(`/me/bookmarks?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

/** `smart` asks for the background summary. See the bookmarks handler for why
 *  the summary is not in the response. */
export const addSmartBookmark = (
  editionId: string,
  positionSec: number,
  label?: string,
) =>
  call<{ bookmark: MarkRow; created: boolean }>("/me/bookmarks", {
    method: "POST",
    body: JSON.stringify({ editionId, positionSec, label, kind: "bookmark", smart: true }),
  });

export type StudyPlanState = {
  plan: {
    dailyMinutes: number;
    daysOfWeek: number[];
    reminderAt: string;
    bookSlug: string | null;
    targetDate: string | null;
  } | null;
  dayNames: string[];
  today: {
    minutes: number;
    scheduled?: boolean;
    goalMet?: boolean;
    remainingMinutes?: number;
  };
  book?: {
    slug: string;
    title: string;
    percent: number | null;
    remainingMinutes: number | null;
    sessionsNeeded: number | null;
    estimatedFinish: string | null;
  } | null;
};

export const getPlan = () => call<StudyPlanState>("/me/plan");

export const savePlan = (input: {
  dailyMinutes: number;
  daysOfWeek: number[];
  reminderAt: string;
  bookSlug: string | null;
}) =>
  call<{ plan: StudyPlanState["plan"] }>("/me/plan", {
    method: "PUT",
    body: JSON.stringify(input),
  });

export const deletePlan = () => call<{ ok: boolean }>("/me/plan", { method: "DELETE" });

export type NotificationRow = {
  id: string;
  kind: "renewal" | "kids" | "recap" | "gift" | "plan" | "system";
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export const getNotifications = () =>
  call<{ items: NotificationRow[]; unread: number }>("/me/notifications");

export const markNotificationsRead = (input: { id?: string; all?: boolean }) =>
  call<{ unread: number }>("/me/notifications", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const clearNotifications = () =>
  call<{ ok: boolean }>("/me/notifications", { method: "DELETE" });

export type ReferralState = {
  code: string;
  invitePath: string;
  rewardRial: number;
  earnedRial: number;
  invited: { phone: string; joinedAt: string; activated: boolean }[];
};

export const getReferrals = () => call<ReferralState>("/me/referrals");

export type NarrationRow = {
  id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  voiceName: string | null;
  stage: number;
  stageName: string;
  stageCount: number;
  status: "queued" | "processing" | "review" | "done" | "failed";
  note: string | null;
  createdAt: string;
};

export const getNarrationRequests = () =>
  call<{ items: NarrationRow[]; stages: string[] }>("/me/narration-requests");

/**
 * Upload a PDF.
 *
 * Bypasses `call` because the body is `FormData`, and `call` sets a JSON
 * content-type. Letting the browser set it here is not a style choice: a
 * multipart body needs a boundary parameter that only the browser knows, and
 * overriding the header strips it and makes the body unparseable.
 */
export async function uploadForNarration(input: {
  file: File;
  title: string;
  voiceId: string;
}) {
  const form = new FormData();
  form.set("file", input.file);
  form.set("title", input.title);
  form.set("voiceId", input.voiceId);

  const res = await fetch(`${PLATFORM_BASE}/api/v1/me/narration-requests`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(body.error ?? "unknown"),
      String(body.message ?? "بارگذاری انجام نشد."),
      body,
    );
  }
  return body as { request: NarrationRow };
}
