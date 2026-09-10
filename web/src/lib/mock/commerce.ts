/**
 * Subscriptions, codes, gifts and refunds.
 *
 * Everything in this file is a *decision*, which is why none of it is in a
 * component. The spec's tier table, the coupon arithmetic and the refund window
 * are business rules; a screen that knew any of them would be a second place
 * they could be wrong, and the Flutter app would then make a third.
 *
 * The one rule worth reading before the code: a subscription does not grant
 * access by being consulted at play time. It grants an `Entitlement` with
 * `source: "subscription"` and `expiresAt` set to the end of the paid period.
 * The spec asks for exactly that — «حق دسترسی، جدا از تراکنش خرید؛ با منشأ
 * خرید، هدیه، اشتراک یا سازمان، و تاریخ انقضا» — and it means the shelf, the
 * player and the kids policy all read one table and never learn what a
 * subscription is.
 */

import type { AudioEdition } from "@/lib/catalog";
import {
  activeSubscription,
  balanceOf,
  db,
  findEditionById,
  hasEntitlement,
  notify,
  uid,
  type Subscription,
  type SubscriptionTier,
} from "./db";

/* ── Tiers ───────────────────────────────────────────────────────────────— */

export interface TierSpec {
  id: SubscriptionTier;
  name: string;
  monthlyRial: number;
  /** How much of the catalogue the tier opens. */
  covers: "free" | "most" | "all";
  /** The spec's `Device` row exists so this cap is enforceable. */
  concurrentDevices: number;
  childProfiles: number;
  perks: string[];
}

/**
 * Three tiers, priced in Rial.
 *
 * `covers` is a rule, not a list. Tying a tier to enumerated slugs would mean
 * every new book needs a decision in three places before it can be sold, and
 * the one that got forgotten would be invisible until a subscriber complained.
 */
export const TIERS: TierSpec[] = [
  {
    id: "basic",
    name: "پایه",
    monthlyRial: 490_000,
    covers: "free",
    concurrentDevices: 1,
    childProfiles: 1,
    perks: [
      "کتاب‌های رایگان و کلاسیک‌های عمومی",
      "کتاب‌یار روی همان کتاب‌ها",
      "یک دستگاه هم‌زمان",
    ],
  },
  {
    id: "plus",
    name: "پلاس",
    monthlyRial: 1_290_000,
    covers: "most",
    concurrentDevices: 2,
    childProfiles: 2,
    perks: [
      "همه‌ی کتاب‌های کاتالوگ به‌جز نسخه‌های ویژه",
      "گویش‌ها و روایت‌های انسانی",
      "دو دستگاه هم‌زمان",
      "دانلود آفلاین",
    ],
  },
  {
    id: "family",
    name: "خانواده",
    monthlyRial: 1_990_000,
    covers: "all",
    concurrentDevices: 4,
    childProfiles: 4,
    perks: [
      "کل کاتالوگ، بدون استثنا",
      "تا چهار پروفایل کودک",
      "چهار دستگاه هم‌زمان",
      "گزارش هفتگی برای هر کودک",
    ],
  },
];

export const tierSpec = (id: SubscriptionTier) =>
  TIERS.find((t) => t.id === id) ?? TIERS[0];

/**
 * The threshold above which an edition is a «نسخه ویژه».
 *
 * A number rather than a flag on the edition, because "special" here means
 * "priced like a premium release" and the price is already the source of truth.
 * A separate boolean could disagree with it, and then the catalogue badge and
 * the entitlement check would tell a subscriber two different things.
 *
 * Set against the actual catalogue, not picked as a round figure. The most
 * expensive edition in the catalogue is 1,390,000 Rial, so a threshold above
 * that would leave `most` and `all` covering exactly the same books — پلاس and
 * خانواده would be the same product at two prices, and a percentage discount
 * code would be unspendable for any subscriber, because every purchase would
 * already be free. At one million the split is real: the long novels sit above
 * it and everything else below.
 */
const PREMIUM_THRESHOLD_RIAL = 1_000_000;

/** Whether a tier opens this edition. */
export function tierCovers(tier: SubscriptionTier, edition: AudioEdition) {
  const spec = tierSpec(tier);
  if (spec.covers === "all") return true;
  if (spec.covers === "most") return edition.priceRial < PREMIUM_THRESHOLD_RIAL;
  return edition.priceRial === 0;
}

/** Whether *this user's current* subscription opens it. Null-safe on purpose. */
export function subscriptionCovers(userId: string, edition: AudioEdition) {
  const sub = activeSubscription(userId);
  return sub ? tierCovers(sub.tier, edition) : false;
}

/**
 * Add a subscription-covered edition to the shelf.
 *
 * Returns the entitlement, or null when the subscription does not reach it.
 * The expiry is the end of the *paid period*, not a month from now: if someone
 * subscribes on the 28th and adds a book on the 29th, that book's access ends
 * with the period they actually paid for.
 */
export function claimWithSubscription(userId: string, editionId: string) {
  const found = findEditionById(editionId);
  const sub = activeSubscription(userId);
  if (!found || !sub || !tierCovers(sub.tier, found.edition)) return null;
  if (hasEntitlement(userId, editionId)) return null;

  const entitlement = {
    id: `ent_${uid()}`,
    userId,
    editionId,
    source: "subscription" as const,
    grantedAt: new Date().toISOString(),
    expiresAt: sub.currentPeriodEnd,
  };
  db.entitlements.push(entitlement);
  return entitlement;
}

/* ── The ledger, written from one place ──────────────────────────────────— */

/**
 * Append a ledger line.
 *
 * Every credit and debit in the product goes through this, so "the balance is
 * the sum of the ledger" stays true by construction rather than by everyone
 * remembering. Amount is signed; the caller decides the direction.
 */
export function post(
  userId: string,
  amountRial: number,
  kind: "topup" | "purchase" | "refund" | "gift_received" | "promo",
  memo: string,
  orderId?: string,
) {
  const entry = {
    id: `led_${uid()}`,
    userId,
    amountRial,
    kind,
    memo,
    ...(orderId ? { orderId } : {}),
    createdAt: new Date().toISOString(),
  };
  db.ledger.push(entry);
  return entry;
}

/* ── Subscribing ─────────────────────────────────────────────────────────— */

export type StartResult =
  | { ok: true; subscription: Subscription }
  | { ok: false; error: string; message: string; status: number; shortfallRial?: number };

/**
 * Start or extend a subscription, paid from the wallet.
 *
 * Extending adds a month to the *existing* period end rather than to today, so
 * a subscriber who renews early does not lose the days they had left. That is
 * the whole reason renewal is expressed as an extension: with no auto-renew,
 * every renewal is early or late, and the late case must not be punished twice.
 */
export function startSubscription(userId: string, tier: SubscriptionTier): StartResult {
  const spec = TIERS.find((t) => t.id === tier);
  if (!spec) {
    return { ok: false, error: "unknown_tier", message: "این طرح وجود ندارد.", status: 404 };
  }

  const price = spec.monthlyRial;
  const balance = balanceOf(userId);
  if (balance < price) {
    return {
      ok: false,
      error: "insufficient_funds",
      message: "موجودی کیف پول برای این طرح کافی نیست.",
      status: 402,
      shortfallRial: price - balance,
    };
  }

  post(userId, -price, "purchase", `اشتراک ${spec.name} — یک ماه`);

  const existing = activeSubscription(userId);
  const now = new Date().toISOString();
  const base = existing ? Date.parse(existing.currentPeriodEnd) : Date.now();
  const periodEnd = new Date(base + 30 * 86_400_000).toISOString();

  if (existing) {
    existing.tier = tier;
    existing.status = "active";
    existing.currentPeriodEnd = periodEnd;
    existing.cancelledAt = null;
    notify(
      userId,
      "renewal",
      `اشتراک ${spec.name} تمدید شد`,
      `تا ${fmtDate(periodEnd)} فعال است.`,
      "/account/subscription",
    );
    return { ok: true, subscription: existing };
  }

  const created = {
    id: `sub_${uid()}`,
    userId,
    tier,
    status: "active" as const,
    startedAt: now,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
  };
  db.subscriptions.push(created);
  notify(
    userId,
    "renewal",
    `اشتراک ${spec.name} فعال شد`,
    `تا ${fmtDate(periodEnd)}. تمدید خودکار نداریم — نزدیک پایان دوره یادآوری می‌کنیم.`,
    "/account/subscription",
  );
  return { ok: true, subscription: created };
}

/**
 * Cancel.
 *
 * Marks the intent and leaves the period running. Nothing is refunded and
 * nothing is revoked, because the month was paid for; what stops is the next
 * charge — which, with no auto-renew, was never going to happen unaided anyway.
 * The honest effect of cancelling here is that the reminder stops.
 */
export function cancelSubscription(userId: string) {
  const sub = activeSubscription(userId);
  if (!sub) return null;
  sub.status = "cancelled";
  sub.cancelledAt = new Date().toISOString();
  return sub;
}

/* ── Codes ───────────────────────────────────────────────────────────────— */

export type RedeemResult =
  | { ok: true; kind: "credit"; amountRial: number; label: string; balanceRial: number }
  | { ok: true; kind: "percent"; percent: number; label: string }
  | { ok: false; error: string; message: string; status: number };

/**
 * Redeem a discount code, gift card or voucher.
 *
 * Codes are matched case-insensitively and with Persian digits folded, because
 * a code is something a person copies off a poster or retypes from a text
 * message. Rejecting `ketapod30` when the poster said `KETAPOD30` is a support
 * ticket, not a security measure.
 */
export function redeem(userId: string, rawCode: string): RedeemResult {
  const code = normaliseCode(rawCode);
  if (!code) {
    return { ok: false, error: "empty_code", message: "کد را وارد کنید.", status: 422 };
  }

  const coupon = db.coupons.find((c) => c.code === code);
  if (!coupon) {
    return { ok: false, error: "unknown_code", message: "این کد معتبر نیست.", status: 404 };
  }
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < Date.now()) {
    return { ok: false, error: "expired", message: "مهلت این کد گذشته است.", status: 410 };
  }
  if (coupon.redeemedBy.includes(userId)) {
    return {
      ok: false,
      error: "already_redeemed",
      message: "این کد را قبلاً استفاده کرده‌اید.",
      status: 409,
    };
  }
  if (coupon.redeemedBy.length >= coupon.maxRedemptions) {
    return {
      ok: false,
      error: "exhausted",
      message: "ظرفیت این کد تمام شده است.",
      status: 409,
    };
  }

  coupon.redeemedBy.push(userId);

  /* A percentage code is not money and must not touch the ledger. It is held
     against the account and applied at the next purchase — writing it in as a
     credit would let someone redeem "۳۰٪ تخفیف" and withdraw it as balance. */
  if (coupon.kind === "percent") {
    db.pendingDiscounts.set(userId, { percent: coupon.value, code: coupon.code });
    return { ok: true, kind: "percent", percent: coupon.value, label: coupon.label };
  }

  post(userId, coupon.value, coupon.kind === "giftcard" ? "gift_received" : "promo", coupon.label);
  return {
    ok: true,
    kind: "credit",
    amountRial: coupon.value,
    label: coupon.label,
    balanceRial: balanceOf(userId),
  };
}

/** The percent discount waiting to be applied to this user's next purchase. */
export const pendingDiscount = (userId: string) => db.pendingDiscounts.get(userId) ?? null;

export const consumeDiscount = (userId: string) => db.pendingDiscounts.delete(userId);

/**
 * Fold a typed code to its canonical form.
 *
 * Persian and Arabic-Indic digits are mapped to ASCII: a code shown as
 * `KETAB1404` on a Persian page is very often retyped as `KETAB۱۴۰۴`, and those
 * are the same code to everyone except a string comparison.
 */
export function normaliseCode(raw: string) {
  const digits: Record<string, string> = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return (raw ?? "")
    .trim()
    .replace(/[۰-۹٠-٩]/g, (d) => digits[d] ?? d)
    .replace(/[\s‌-]/g, "")
    .toUpperCase();
}

/* ── Gifting ─────────────────────────────────────────────────────────────— */

/**
 * Buy an edition for someone else.
 *
 * The buyer is charged now and no entitlement is created for anybody: the gift
 * is a claim waiting for a person. That is deliberate — creating the recipient's
 * entitlement at purchase time would need the recipient to already have an
 * account, which is exactly the requirement the spec's web-first claim link
 * exists to remove.
 */
export function createGift(
  userId: string,
  editionId: string,
  toPhone: string | null,
  message: string,
) {
  const found = findEditionById(editionId);
  if (!found) return { ok: false as const, error: "unknown_edition", status: 404 };

  const price = found.edition.priceRial;
  if (balanceOf(userId) < price) {
    return {
      ok: false as const,
      error: "insufficient_funds",
      status: 402,
      shortfallRial: price - balanceOf(userId),
    };
  }

  const buyer = db.users.find((u) => u.id === userId);
  post(userId, -price, "purchase", `هدیه‌ی ${found.book.title}`);

  const gift = {
    id: `gft_${uid()}`,
    code: giftCode(),
    fromUserId: userId,
    fromName: buyer?.name ?? "یکی از دوستان",
    toPhone,
    editionId,
    message,
    priceRial: price,
    claimedByUserId: null,
    claimedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.gifts.push(gift);
  return { ok: true as const, gift, book: found.book };
}

/**
 * Claim a gift.
 *
 * The recipient's phone, when the sender set one, is checked against the
 * claimant's — otherwise a leaked link is a free book for whoever finds it
 * first. When the sender left it open, the link itself is the bearer token and
 * the first claim wins, which is the trade the sender made knowingly.
 */
export function claimGift(userId: string, rawCode: string) {
  const code = normaliseCode(rawCode);
  const gift = db.gifts.find((g) => normaliseCode(g.code) === code);
  if (!gift) return { ok: false as const, error: "unknown_code", status: 404 };
  if (gift.claimedByUserId) {
    return { ok: false as const, error: "already_claimed", status: 409 };
  }

  const claimant = db.users.find((u) => u.id === userId);
  if (gift.toPhone && claimant && claimant.phone !== gift.toPhone) {
    /* 404 rather than 403: telling a stranger "this code is real but not for
       you" confirms the code exists, which is the one bit worth guessing at. */
    return { ok: false as const, error: "unknown_code", status: 404 };
  }
  if (gift.fromUserId === userId) {
    return { ok: false as const, error: "own_gift", status: 409 };
  }

  const now = new Date().toISOString();
  gift.claimedByUserId = userId;
  gift.claimedAt = now;
  db.entitlements.push({
    id: `ent_${uid()}`,
    userId,
    editionId: gift.editionId,
    source: "gift",
    grantedAt: now,
    expiresAt: null,
  });

  const found = findEditionById(gift.editionId);
  notify(
    gift.fromUserId,
    "gift",
    "هدیه‌ی شما دریافت شد",
    `${found?.book.title ?? "کتاب"} به دست گیرنده رسید.`,
    "/account/gifts",
  );
  return { ok: true as const, gift, book: found?.book };
}

/** Human-typable: no O/0 or I/1 confusion, grouped for reading aloud. */
function giftCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${pick()}-${pick()}`;
}

/* ── Referrals ───────────────────────────────────────────────────────────— */

/** Paid to *both* sides, so the invitee has a reason to use the code they got. */
export const REFERRAL_REWARD_RIAL = 300_000;

/** A code that survives being read aloud and retyped. */
export function makeReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = Array.from(
    { length: 5 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
  return `KETA-${pick}`;
}

/**
 * Attach a new account to whoever invited it.
 *
 * Called once, at signup. Nothing is paid here: the reward lands on the
 * invitee's first real listening session, via `settleReferral`. Paying at signup
 * turns an invite code into a bounty on throwaway phone numbers, and the spec
 * already restricts the kids version of this flow for related reasons.
 */
export function attachReferral(newUserId: string, rawCode: string) {
  const code = normaliseCode(rawCode);
  const inviter = db.users.find((u) => normaliseCode(u.referralCode) === code);
  const invitee = db.users.find((u) => u.id === newUserId);
  if (!inviter || !invitee || inviter.id === invitee.id) return false;
  if (invitee.referredByUserId) return false;

  invitee.referredByUserId = inviter.id;
  return true;
}

/**
 * Pay both sides, once the invitee has actually listened.
 *
 * Idempotent through the ledger rather than a flag: the memo carries the
 * invitee's id, so a second call finds the existing line and does nothing. That
 * is the same trick the ledger already uses to be the single source of truth,
 * and it means there is no "rewarded" boolean that can disagree with the money.
 */
export function settleReferral(inviteeId: string) {
  const invitee = db.users.find((u) => u.id === inviteeId);
  if (!invitee?.referredByUserId) return;

  const marker = `دعوت:${inviteeId}`;
  if (db.ledger.some((l) => l.memo.includes(marker))) return;

  post(invitee.referredByUserId, REFERRAL_REWARD_RIAL, "promo", `پاداش دعوت دوست — ${marker}`);
  post(inviteeId, REFERRAL_REWARD_RIAL, "promo", `هدیه‌ی ثبت‌نام با دعوت — ${marker}`);
  notify(
    invitee.referredByUserId,
    "system",
    "پاداش دعوت شما پرداخت شد",
    `${REFERRAL_REWARD_RIAL.toLocaleString("fa-IR")} ریال به کیف پولتان اضافه شد.`,
    "/wallet",
  );
}

/* ── Refunds ─────────────────────────────────────────────────────────────— */

/**
 * The window inside which a purchase can be undone without asking anyone.
 *
 * Seven days, and — the part that matters — only while the listener has barely
 * started. An audiobook is fully consumable on first play, so a refund policy
 * keyed on time alone is a rental scheme with extra steps.
 */
export const REFUND_WINDOW_DAYS = 7;
export const REFUND_MAX_PROGRESS = 0.1;

export function refundOrder(userId: string, orderId: string) {
  const order = db.orders.find((o) => o.id === orderId && o.userId === userId);
  if (!order) return { ok: false as const, error: "unknown_order", status: 404 };
  if (order.status === "refunded") {
    return { ok: false as const, error: "already_refunded", status: 409 };
  }

  const ageDays = (Date.now() - Date.parse(order.createdAt)) / 86_400_000;
  if (ageDays > REFUND_WINDOW_DAYS) {
    return {
      ok: false as const,
      error: "window_closed",
      status: 422,
      message: `مهلت بازپرداخت ${REFUND_WINDOW_DAYS} روز است.`,
    };
  }

  const found = findEditionById(order.editionId);
  const position = db.positions.find(
    (p) => p.userId === userId && p.editionId === order.editionId,
  );
  const progress =
    position && found ? position.positionSec / found.edition.durationSec : 0;
  if (progress > REFUND_MAX_PROGRESS) {
    return {
      ok: false as const,
      error: "too_much_listened",
      status: 422,
      message: `بیش از ${Math.round(REFUND_MAX_PROGRESS * 100)}٪ کتاب شنیده شده است.`,
    };
  }

  order.status = "refunded";
  post(userId, order.priceRial, "refund", `بازپرداخت ${found?.book.title ?? ""}`, order.id);

  /* The entitlement created by this order goes with it. Refunding the money and
     leaving the book is not a policy, it is a bug someone will find. */
  db.entitlements = db.entitlements.filter(
    (e) => !(e.userId === userId && e.editionId === order.editionId && e.source === "purchase"),
  );

  return { ok: true as const, order, balanceRial: balanceOf(userId) };
}

/* ── Formatting shared by the notifications this module writes ────────────— */

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" }).format(
    new Date(iso),
  );
