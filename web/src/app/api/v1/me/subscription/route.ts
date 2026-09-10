import {
  TIERS,
  cancelSubscription,
  startSubscription,
  tierSpec,
} from "@/lib/mock/commerce";
import { activeSubscription, balanceOf, db, type SubscriptionTier } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * The subscription, and the tiers on offer.
 *
 * `renewalDue` is computed here rather than in the banner that shows it. The
 * spec's commerce note is that Iranian gateways cannot auto-renew and the
 * product must therefore *remind* — «یادآوری تمدید با push و پیامک ساخته شود» —
 * so when the reminder fires is a policy, and a policy does not belong in a
 * component that a second client will have to reimplement.
 */

/** Remind this many days out. Long enough to act, short enough to still mean it. */
const REMIND_WITHIN_DAYS = 7;

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const sub = activeSubscription(user.id);
  const daysLeft = sub
    ? Math.max(0, Math.ceil((Date.parse(sub.currentPeriodEnd) - Date.now()) / 86_400_000))
    : null;

  return Response.json({
    subscription: sub
      ? { ...sub, tierName: tierSpec(sub.tier).name, daysLeft }
      : null,
    renewalDue: daysLeft !== null && daysLeft <= REMIND_WITHIN_DAYS,
    tiers: TIERS,
    balanceRial: balanceOf(user.id),
    /* Past periods, so the screen can show what was paid rather than only what
       is running. Read off the ledger because that is where the money is. */
    history: db.ledger
      .filter((l) => l.userId === user.id && l.memo.startsWith("اشتراک"))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  });
}

/** Subscribe, upgrade or renew — all one operation, paid from the wallet. */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { tier } = (await req.json().catch(() => ({}))) as { tier?: SubscriptionTier };
  if (!tier) return Response.json({ error: "missing_tier" }, { status: 422 });

  const result = startSubscription(auth.user.id, tier);
  if (!result.ok) {
    const { status, ...payload } = result;
    return Response.json(payload, { status });
  }

  return Response.json({
    subscription: { ...result.subscription, tierName: tierSpec(result.subscription.tier).name },
    balanceRial: balanceOf(auth.user.id),
  });
}

/**
 * Cancel.
 *
 * Answers 200 with the still-running subscription rather than 204, because
 * nothing disappeared: the paid period continues and the screen needs to keep
 * showing it, now with an end date and no reminder. A 204 would invite the
 * client to clear the card, which would tell the user they lost the days they
 * had already bought.
 */
export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const sub = cancelSubscription(auth.user.id);
  if (!sub) return Response.json({ error: "no_subscription" }, { status: 404 });
  return Response.json({ subscription: { ...sub, tierName: tierSpec(sub.tier).name } });
}
