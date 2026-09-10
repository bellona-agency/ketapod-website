/**
 * The mock platform database.
 *
 * The spec puts every business rule in the Go core and says the front end may
 * only display. That rule is what makes this file possible: the web app needs
 * *a* server that answers the API contract, not specifically the Go one. So the
 * authenticated surface is built against `/api/v1/...` route handlers backed by
 * this store, and pointing `NEXT_PUBLIC_API_BASE_URL` at the real core later is
 * a base-URL change rather than a rewrite of every page.
 *
 * Two consequences are deliberate:
 *
 *   * Business rules live *here*, not in components. Entitlement checks, the
 *     wallet balance and the kids policy are computed on this side of the wire
 *     for the same reason the spec gives — a rule written in the component gets
 *     written twice more when the Flutter app arrives, and then the three
 *     diverge.
 *   * Nothing is persisted. This is a demonstration of behaviour, not a
 *     database; a restart returns to the seed. Where a real rule would be
 *     enforced by a constraint, the note says so.
 */

import { BOOKS, VOICES } from "@/lib/catalog";
import type { AudioEdition, Book } from "@/lib/catalog";

/* ── Domain types ────────────────────────────────────────────────────────—
   These mirror the spec's data-model table. The two shapes worth reading
   closely are `WalletLedger` and `Entitlement`, because both are modelled the
   way the spec insists and neither is the obvious shortcut.                */

export interface User {
  id: string;
  /** Login identity. The spec's auth is OTP over SMS — no password, no email. */
  phone: string;
  name?: string;
  createdAt: string;
  /** `creator` unlocks the studio tile; `admin` the moderation panel. */
  roles: ("listener" | "creator" | "publisher" | "org_admin" | "admin")[];
  /**
   * The user's own invite code.
   *
   * On the account rather than in a `referrals` table because it is one per
   * user for the life of the account, and the spec's requirement — «لینک دعوت
   * باید صفحه وب باز کند نه اپ» — means this code has to be resolvable by a
   * page the invitee reaches before they have installed anything.
   */
  referralCode: string;
  /** Set once, at signup, from the code the invitee arrived with. */
  referredByUserId?: string;
}

/** A pending SMS challenge. Real deployments send this; the mock returns it. */
export interface OtpChallenge {
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

/**
 * A refresh token, stored so it can be revoked.
 *
 * The spec asks for a short-lived access token and an *opaque* refresh token
 * held in the database precisely so that logging out, or losing a device, can
 * invalidate a session server-side. A self-contained JWT refresh token cannot
 * be withdrawn before it expires.
 */
export interface Session {
  refreshToken: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  accessExpiresAt: number;
  createdAt: string;
}

/** Per the spec: the row that makes a concurrent-playback cap possible. */
export interface Device {
  id: string;
  userId: string;
  label: string;
  lastSeenAt: string;
}

/**
 * The right to listen — deliberately *not* the purchase that created it.
 *
 * The spec separates these so that a gift, a coupon, an organisation seat and a
 * subscription can all grant access without any of them having to be modelled
 * as a payment. `source` records which one it was; `expiresAt` is null for a
 * permanent purchase and set for the rest.
 */
export interface Entitlement {
  id: string;
  userId: string;
  editionId: string;
  source: "purchase" | "gift" | "subscription" | "org" | "promo";
  grantedAt: string;
  expiresAt: string | null;
}

/**
 * One line of the append-only wallet ledger.
 *
 * The spec is explicit that a balance is a *derived* number and never a column,
 * because a stored balance and a transaction history can disagree and only one
 * of them can be audited. `balanceOf` below is the only way to read a balance.
 * Amounts are Rial and signed: credit positive, debit negative.
 */
export interface LedgerEntry {
  id: string;
  userId: string;
  amountRial: number;
  kind: "topup" | "purchase" | "refund" | "gift_received" | "promo";
  /** Human-readable, shown in the wallet history. */
  memo: string;
  /** Set when the line was caused by an order, for reconciliation. */
  orderId?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  editionId: string;
  priceRial: number;
  status: "paid" | "refunded";
  createdAt: string;
}

/**
 * Playback position, keyed on the *edition* rather than the book.
 *
 * The spec calls this out specifically: a listener who switches from the human
 * narration to the AI one is at a different second in a different performance,
 * and a position stored per book would silently overwrite one with the other.
 */
export interface ListeningPosition {
  userId: string;
  editionId: string;
  positionSec: number;
  /** Device clock, used for the spec's last-write-wins conflict rule. */
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  userId: string;
  editionId: string;
  positionSec: number;
  label: string;
  createdAt: string;
  /**
   * The "smart bookmark" of the feature matrix — a summary of what was being
   * said at this second.
   *
   * The spec's note is the whole design: «خلاصه در پس‌زمینه توسط worker ساخته
   * شود، نه هم‌زمان با کلیک کاربر». So a bookmark is created immediately with
   * `summaryState: "pending"` and the text arrives afterwards; the button never
   * waits on a model, because a bookmark that takes two seconds to appear is a
   * bookmark the listener has already stopped trusting.
   */
  summary: string | null;
  summaryState: "none" | "pending" | "ready";
}

export interface Note {
  id: string;
  userId: string;
  editionId: string;
  positionSec: number;
  body: string;
  createdAt: string;
}

/**
 * A child, as a subresource of the parent account.
 *
 * The spec puts this in a warning box and it is the one decision in the kids
 * domain that cannot be walked back: `ChildProfile` carries `parentUserId` and
 * is **not** a row in `users`. Ownership, payment, entitlement and privacy all
 * resolve to the parent, so a child that were its own user would need an
 * exception written at every one of those points.
 *
 * Everything a child touches therefore already belongs to the parent — the
 * wallet that paid, the entitlement that grants, the device that plays.
 */
export interface ChildProfile {
  id: string;
  parentUserId: string;
  name: string;
  /** Drives the content filter; the spec keys the kids catalogue off age. */
  age: number;
  /** Daily screen-time cap in minutes. Null means uncapped. */
  dailyCapMinutes: number | null;
  /**
   * Explicit parent decisions, by book slug.
   *
   * Blocked always wins. Allowed only matters when `approvedOnly` is set, which
   * narrows the shelf from "anything age-appropriate" to "what I picked".
   */
  allowedBookSlugs: string[];
  blockedBookSlugs: string[];
  approvedOnly: boolean;
  avatar: "fox" | "owl" | "whale" | "robot";
  createdAt: string;
}

/**
 * Minutes listened, per child per day.
 *
 * Its own append-only record rather than something derived from positions: a
 * position is a bookmark. It says where the child is, not how long they were
 * there, and it moves *backwards* when they replay a chapter. The daily cap and
 * the weekly report both need elapsed time, which only this carries.
 */
export interface ListeningSession {
  id: string;
  /**
   * Whose listening this was.
   *
   * A child profile when the kids player reported it, otherwise the account
   * itself. Both are elapsed seconds actually listened, which is the only
   * reason this table exists separately from `positions`.
   */
  childProfileId: string | null;
  userId: string;
  editionId: string;
  /** `YYYY-MM-DD`, local — the unit both the cap and the report count in. */
  day: string;
  seconds: number;
  startedAt: string;
}

/** The parent's PIN for leaving kids mode. */
export interface KidsLock {
  userId: string;
  pin: string;
}

/* ── The account's own settings ──────────────────────────────────────────— */

/**
 * Everything the listener can change about how the product behaves for them.
 *
 * One row rather than columns on `users` because these are preferences and
 * those are identity: a preference can be reset, exported, or defaulted for a
 * new device, and none of that should touch the row that owns the wallet.
 *
 * The notification flags carry the kids rule from the spec's warning box —
 * «هیچ نوتیفیکیشنی به دستگاه کودک نرود --- همه به گوشی والد». There is no
 * per-child notification setting anywhere in this file, and that is the reason.
 */
export interface UserPrefs {
  userId: string;
  /** Player defaults, applied when an edition is opened for the first time. */
  playbackRate: number;
  skipForwardSec: number;
  skipBackSec: number;
  autoplayNextChapter: boolean;
  /** Which performance to pick when a book has several. */
  preferredNarrator: "human" | "ai" | "any";
  preferredDialect: string | null;
  notify: {
    renewal: boolean;
    kidsActivity: boolean;
    recap: boolean;
    newRelease: boolean;
  };
}

export type SubscriptionTier = "basic" | "plus" | "family";

/**
 * A running subscription.
 *
 * `autoRenew` is absent by design, not by omission. The spec's commerce row
 * says «درگاه‌های ایرانی تمدید خودکار کامل ندارند؛ یادآوری تمدید با push و
 * پیامک ساخته شود», so the period simply ends and a reminder goes out. Modelling
 * an auto-renew flag would invite a renewal job that no gateway here can
 * actually honour, and the first month it silently failed would look like theft.
 */
export interface Subscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: "active" | "expired" | "cancelled";
  startedAt: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
}

/**
 * A payment in flight at the gateway.
 *
 * Its own row because the money leaves the browser and comes back through a
 * callback the user's own tab does not control. Without a stored intent there
 * is nothing to reconcile a callback against, and a duplicate callback would
 * credit the wallet twice — which is why `status` moves out of `pending` once
 * and `settle` refuses a second attempt.
 */
export interface PaymentIntent {
  id: string;
  userId: string;
  amountRial: number;
  purpose: "topup" | "subscription";
  tier: SubscriptionTier | null;
  status: "pending" | "paid" | "failed" | "cancelled";
  /** Stands in for the bank's own reference, shown on the receipt. */
  gatewayRef: string;
  returnPath: string;
  createdAt: string;
  settledAt: string | null;
}

/**
 * A redeemable code: discount, gift card, or promotional credit.
 *
 * All three are one table because they differ only in what redemption *does*,
 * and the spec groups them in one row — «کد تخفیف، کارت هدیه، بن». Keeping them
 * apart would mean three redemption endpoints that a user experiences as one
 * box to type a code into.
 */
export interface Coupon {
  code: string;
  kind: "percent" | "giftcard" | "credit";
  /** Percent 0–100 for `percent`, Rial for the other two. */
  value: number;
  maxRedemptions: number;
  redeemedBy: string[];
  expiresAt: string | null;
  label: string;
}

/**
 * A book bought for someone else.
 *
 * The claim is keyed on a code rather than on the recipient's account, because
 * the spec wants the whole flow to work before the recipient exists: «هدیه کتاب
 * به شخص دیگر --- جریان کاملاً وب‌محور با لینک دریافت». They follow a link, log
 * in with OTP — creating the account at that moment — and the entitlement lands.
 */
export interface Gift {
  id: string;
  code: string;
  fromUserId: string;
  fromName: string;
  toPhone: string | null;
  editionId: string;
  message: string;
  priceRial: number;
  claimedByUserId: string | null;
  claimedAt: string | null;
  createdAt: string;
}

/** A book on the wish list. Keyed on the book, not the edition — the listener
 *  is saving a work, and has not yet chosen whose voice to hear it in. */
export interface Favourite {
  userId: string;
  bookSlug: string;
  createdAt: string;
}

/**
 * برنامه مطالعاتی — a daily goal, and the reminder that carries it.
 *
 * The goal is minutes rather than chapters or pages: minutes are the unit the
 * listening ledger already counts in, so progress against the plan is a read of
 * data that exists rather than a second thing to keep in step.
 */
export interface StudyPlan {
  userId: string;
  dailyMinutes: number;
  /** 0 = Saturday, matching the Persian week the UI renders. */
  daysOfWeek: number[];
  /** Local `HH:MM`; the reminder is a notification, never an SMS in the mock. */
  reminderAt: string;
  bookSlug: string | null;
  targetDate: string | null;
  createdAt: string;
}

/**
 * An in-app notification.
 *
 * Always addressed to a `userId` — an account — and never to a child profile.
 * That is rule four of the kids policy expressed in the schema instead of in a
 * check: there is no column here that could carry a child's device, so a
 * notification about a child's listening can only be delivered to the parent.
 */
export interface AppNotification {
  id: string;
  userId: string;
  kind: "renewal" | "kids" | "recap" | "gift" | "plan" | "system";
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * A PDF submitted for narration.
 *
 * The spec's production pipeline has nine stages and the listener is entitled
 * to see which one their book is at, so `stage` is stored rather than inferred
 * from `status`. Nothing here holds the file itself: this store is a
 * demonstration of behaviour, and pretending to keep a hundred megabytes of PDF
 * in memory would be the least honest thing in it.
 */
export interface NarrationRequest {
  id: string;
  userId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  voiceId: string;
  stage: number;
  status: "queued" | "processing" | "review" | "done" | "failed";
  note: string | null;
  createdAt: string;
}

interface Db {
  users: User[];
  otps: OtpChallenge[];
  sessions: Session[];
  devices: Device[];
  entitlements: Entitlement[];
  ledger: LedgerEntry[];
  orders: Order[];
  positions: ListeningPosition[];
  bookmarks: Bookmark[];
  notes: Note[];
  children: ChildProfile[];
  listening: ListeningSession[];
  kidsLocks: KidsLock[];
  prefs: UserPrefs[];
  subscriptions: Subscription[];
  payments: PaymentIntent[];
  coupons: Coupon[];
  gifts: Gift[];
  favourites: Favourite[];
  plans: StudyPlan[];
  notifications: AppNotification[];
  narrationRequests: NarrationRequest[];
  /**
   * A redeemed percentage code, held against the account until it is spent.
   *
   * A map rather than a table because at most one can be waiting: redeeming a
   * second percentage code replaces the first, which is the behaviour every
   * checkout in the country already has and the only one that avoids the
   * question of how two discounts compose.
   */
  pendingDiscounts: Map<string, { percent: number; code: string }>;
}

/* ── Singleton ───────────────────────────────────────────────────────────—
   Held on `globalThis` rather than in a module-level `const`. The dev server
   re-evaluates modules on every edit, and a plain const would silently reset
   the store — and log the developer out — on each save.                     */

declare global {
  var __ketapodDb: Db | undefined;
}

/** The demo account. Any phone works, but this one starts with a history. */
export const DEMO_PHONE = "09120000000";

export const uid = () => Math.random().toString(36).slice(2, 11);

const iso = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString();

/* ── Seed ────────────────────────────────────────────────────────────────— */

/**
 * A catalogue-shaped starting state.
 *
 * The demo user owns three editions, has a part-listened fourth, and carries a
 * wallet balance — enough that the library, the player and the wallet all have
 * something to show on first login rather than three empty states.
 */
function seed(): Db {
  const user: User = {
    id: "usr_demo",
    phone: DEMO_PHONE,
    name: "کاربر نمونه",
    createdAt: iso(-40),
    roles: ["listener", "creator"],
    referralCode: "KETA-DEMO",
  };

  const owned = BOOKS.slice(0, 3)
    .map((b) => defaultEditionOf(b))
    .filter((e): e is AudioEdition => Boolean(e));

  const entitlements: Entitlement[] = owned.map((e, i) => ({
    id: `ent_${uid()}`,
    userId: user.id,
    editionId: e.id,
    /* One of each origin, so the wallet and library screens show that the
       spec's `source` field is load-bearing rather than decorative. */
    source: (["purchase", "gift", "subscription"] as const)[i] ?? "purchase",
    grantedAt: iso(-30 + i * 7),
    expiresAt: i === 2 ? iso(21) : null,
  }));

  const ledger: LedgerEntry[] = [
    {
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: 5_000_000,
      kind: "topup",
      memo: "شارژ کیف پول",
      createdAt: iso(-30),
    },
    {
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: -(owned[0]?.priceRial ?? 0),
      kind: "purchase",
      memo: `خرید ${BOOKS[0]?.title ?? ""}`,
      createdAt: iso(-29),
    },
    {
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: 500_000,
      kind: "promo",
      memo: "هدیه خوش‌آمدگویی",
      createdAt: iso(-28),
    },
  ];

  const positions: ListeningPosition[] = owned.slice(0, 2).map((e, i) => ({
    userId: user.id,
    editionId: e.id,
    /* Partway in, so "ادامه شنیدن" has something to continue. */
    positionSec: Math.round(e.durationSec * (i === 0 ? 0.34 : 0.08)),
    updatedAt: iso(-1),
  }));

  /* The parent also owns three kid-safe editions.
     A child has no entitlements of their own — everything resolves to the
     account that paid — so without these the shelf is correctly but uselessly
     empty, and nothing in the kids surface can be demonstrated. */
  const kidsOwned = BOOKS.flatMap((b) => b.editions)
    .filter((e) => e.isKidsFriendly)
    .slice(0, 3);

  entitlements.push(
    ...kidsOwned.map((e, i) => ({
      id: `ent_${uid()}`,
      userId: user.id,
      editionId: e.id,
      source: "purchase" as const,
      grantedAt: iso(-22 + i),
      expiresAt: null,
    })),
  );

  /* One of them part-listened, so the child's shelf has a «ادامه شنیدن» card —
     which the spec wants as the largest element on their first screen. */
  if (kidsOwned[0]) {
    positions.push({
      userId: user.id,
      editionId: kidsOwned[0].id,
      positionSec: Math.round(kidsOwned[0].durationSec * 0.42),
      updatedAt: iso(-1),
    });
  }

  /* A child on the account from the start, so the parent panel and the kids
     shelf both open onto something rather than onto three empty states. */
  const child: ChildProfile = {
    id: "chp_demo",
    parentUserId: user.id,
    name: "نیلا",
    age: 7,
    dailyCapMinutes: 45,
    allowedBookSlugs: [],
    blockedBookSlugs: [],
    approvedOnly: false,
    avatar: "fox",
    createdAt: iso(-20),
  };

  /* Seven days of history for the weekly report, weighted so the chart has a
     shape — a quiet midweek and a long weekend — instead of a flat bar. */
  const kidEditions = BOOKS.flatMap((b) => b.editions).filter((e) => e.isKidsFriendly);
  const minutesByDay = [12, 30, 0, 22, 41, 55, 18];
  const listening: ListeningSession[] = minutesByDay.flatMap((mins, i) => {
    if (mins === 0 || kidEditions.length === 0) return [];
    const when = new Date(Date.now() - (6 - i) * 86_400_000);
    const edition = kidEditions[i % kidEditions.length];
    return [
      {
        id: `ls_${uid()}`,
        childProfileId: child.id,
        userId: user.id,
        editionId: edition.id,
        day: dayKey(when),
        seconds: mins * 60,
        startedAt: when.toISOString(),
      },
    ];
  });

  /* A subscription three weeks in, so the renewal banner, the remaining-days
     count and the «شامل اشتراک» badge on the catalogue all have a state to be
     in that is neither "never subscribed" nor "expired". */
  const subscription: Subscription = {
    id: `sub_${uid()}`,
    userId: user.id,
    tier: "plus",
    status: "active",
    startedAt: iso(-21),
    currentPeriodEnd: iso(9),
    cancelledAt: null,
  };

  /* Codes a visitor can actually try. They are printed on the redeem screen —
     there is no point hiding fixtures behind a guess. */
  const coupons: Coupon[] = [
    {
      code: "KETAPOD30",
      kind: "percent",
      value: 30,
      maxRedemptions: 100,
      redeemedBy: [],
      expiresAt: iso(30),
      label: "۳۰٪ تخفیف روی خرید بعدی",
    },
    {
      code: "HEDIYE500",
      kind: "giftcard",
      value: 500_000,
      maxRedemptions: 1,
      redeemedBy: [],
      expiresAt: null,
      label: "کارت هدیه ۵۰ هزار تومان",
    },
    {
      code: "KETAB1404",
      kind: "credit",
      value: 200_000,
      maxRedemptions: 500,
      redeemedBy: [],
      expiresAt: iso(60),
      label: "بن نمایشگاه کتاب",
    },
  ];

  return {
    users: [user],
    otps: [],
    sessions: [],
    devices: [],
    entitlements,
    ledger,
    orders: [],
    positions,
    bookmarks: [],
    notes: [],
    children: [child],
    listening,
    kidsLocks: [{ userId: user.id, pin: "1234" }],
    prefs: [defaultPrefs(user.id)],
    subscriptions: [subscription],
    payments: [],
    coupons,
    gifts: [],
    favourites: BOOKS.slice(3, 5).map((b) => ({
      userId: user.id,
      bookSlug: b.slug,
      createdAt: iso(-5),
    })),
    plans: [
      {
        userId: user.id,
        dailyMinutes: 20,
        daysOfWeek: [0, 1, 2, 3, 4],
        reminderAt: "21:30",
        bookSlug: BOOKS[0]?.slug ?? null,
        targetDate: iso(45).slice(0, 10),
        createdAt: iso(-14),
      },
    ],
    notifications: [
      {
        id: `ntf_${uid()}`,
        userId: user.id,
        kind: "kids",
        title: "نیلا امروز به سقف زمانش نزدیک شد",
        body: "۴۱ دقیقه از ۴۵ دقیقه‌ی امروز استفاده شده است.",
        href: "/parent/chp_demo",
        readAt: null,
        createdAt: iso(-0.4),
      },
      {
        id: `ntf_${uid()}`,
        userId: user.id,
        kind: "renewal",
        title: "اشتراک شما تا ۹ روز دیگر تمام می‌شود",
        body: "تمدید خودکار نداریم؛ برای ادامه، خودتان تمدید کنید.",
        href: "/account/subscription",
        readAt: null,
        createdAt: iso(-1),
      },
      {
        id: `ntf_${uid()}`,
        userId: user.id,
        kind: "system",
        title: "به کتاپاد خوش آمدید",
        body: "کیف پول شما با هدیه‌ی خوش‌آمدگویی شارژ شد.",
        href: "/wallet",
        readAt: iso(-27),
        createdAt: iso(-28),
      },
    ],
    narrationRequests: [],
    pendingDiscounts: new Map(),
  };
}

/**
 * The out-of-the-box settings.
 *
 * A row is created on demand rather than at signup, so an account that predates
 * this table still has defaults instead of a null.
 */
export function defaultPrefs(userId: string): UserPrefs {
  return {
    userId,
    playbackRate: 1,
    skipForwardSec: 30,
    skipBackSec: 15,
    autoplayNextChapter: true,
    preferredNarrator: "any",
    preferredDialect: null,
    notify: { renewal: true, kidsActivity: true, recap: true, newRelease: false },
  };
}

export function prefsOf(userId: string): UserPrefs {
  let row = db.prefs.find((p) => p.userId === userId);
  if (!row) {
    row = defaultPrefs(userId);
    db.prefs.push(row);
  }
  return row;
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is UTC: for a listener
 * in Tehran that rolls the day over at 03:30, so a bedtime story counts against
 * tomorrow's cap and lands on the wrong bar of the weekly chart.
 */
export function dayKey(d: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ── Derived reads ───────────────────────────────────────────────────────— */

/**
 * Human narration first, then the longest.
 *
 * Mirrors `defaultEdition` in the catalogue module. Duplicated rather than
 * imported because this side of the wire is standing in for the Go core, and
 * the core will not be importing the front end's helpers.
 */
function defaultEditionOf(book: Book): AudioEdition | undefined {
  const human = book.editions.filter((e) => e.narratorType === "human");
  const pool = human.length > 0 ? human : book.editions;
  return pool.reduce<AudioEdition | undefined>(
    (best, e) => (!best || e.durationSec > best.durationSec ? e : best),
    undefined,
  );
}

/** The balance, summed. Never read from a column, because there isn't one. */
export const balanceOf = (userId: string) =>
  db.ledger
    .filter((l) => l.userId === userId)
    .reduce((sum, l) => sum + l.amountRial, 0);

/**
 * Whether a user may play an edition right now.
 *
 * Expiry is checked on read rather than swept by a job: a subscription that
 * lapsed a minute ago must stop granting access immediately, and a cron that
 * runs nightly would keep it alive until morning.
 */
export function hasEntitlement(userId: string, editionId: string) {
  const now = Date.now();
  return db.entitlements.some(
    (e) =>
      e.userId === userId &&
      e.editionId === editionId &&
      (e.expiresAt === null || Date.parse(e.expiresAt) > now),
  );
}

/**
 * The subscription in force right now, or null.
 *
 * Expiry is evaluated on read for the same reason `hasEntitlement` does it: a
 * period that ended an hour ago must stop granting anything immediately, and a
 * status column swept by a nightly job would keep it alive until morning. A
 * cancelled subscription still runs to the end of the paid period — cancelling
 * stops the next payment, it does not take back the month already bought.
 */
export function activeSubscription(userId: string): Subscription | null {
  const now = Date.now();
  const found = db.subscriptions.find(
    (s) => s.userId === userId && Date.parse(s.currentPeriodEnd) > now && s.status !== "expired",
  );
  return found ?? null;
}

/**
 * Post a notification to an *account*.
 *
 * Everything that wants to tell the user something goes through here, which is
 * what makes the kids rule enforceable: the signature takes a `userId` and
 * there is no overload that takes a child profile. A caller reporting on a
 * child's listening has to resolve the parent first, and the parent is the only
 * address it can reach.
 */
export function notify(
  userId: string,
  kind: AppNotification["kind"],
  title: string,
  body: string,
  href: string | null = null,
) {
  const row: AppNotification = {
    id: `ntf_${uid()}`,
    userId,
    kind,
    title,
    body,
    href,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(row);
  return row;
}

/** Every edition in the catalogue, flattened, with its book and voice resolved. */
export function editionIndex() {
  return BOOKS.flatMap((book) =>
    book.editions.map((edition) => ({
      edition,
      book,
      voice: VOICES.find((v) => v.id === edition.voiceId),
    })),
  );
}

export const findEditionById = (editionId: string) =>
  editionIndex().find((e) => e.edition.id === editionId);

/* ── Instantiation ───────────────────────────────────────────────────────—
   Last in the file on purpose.

   `seed()` reads `DEMO_PHONE`, `uid` and `iso`, which are `const`. A `const` is
   hoisted but left uninitialised until its own line runs, so seeding from the
   top of the module threw `Cannot access '…' before initialization` at request
   time — twice, once per helper, and TypeScript could not see either because
   the temporal dead zone is purely a runtime rule.

   Evaluating here means every declaration above is already initialised, and
   adding a helper later cannot reintroduce the fault. The functions that read
   `db` above are called at request time, long after this line has run.        */

export const db: Db = (globalThis.__ketapodDb ??= seed());
