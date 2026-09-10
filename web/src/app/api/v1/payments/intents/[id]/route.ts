import { post, startSubscription, tierSpec } from "@/lib/mock/commerce";
import { balanceOf, db, notify } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Read and settle a payment.
 *
 * This is the callback half of the gateway dance. Two properties are worth
 * stating because both are load-bearing and neither is obvious from the code:
 *
 *   * **The amount is never taken from the request.** It is read off the stored
 *     intent. The bank tells us *whether* the payment succeeded; how much it was
 *     for was decided when the intent was opened.
 *   * **Settlement happens once.** `status` leaves `pending` under a check, so a
 *     double callback — which every PSP will send you eventually, usually as a
 *     retry after a timeout — cannot credit the wallet twice.
 */

type Ctx = RouteContext<"/api/v1/payments/intents/[id]">;

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  const intent = db.payments.find((p) => p.id === id && p.userId === auth.user.id);
  if (!intent) return Response.json({ error: "unknown_intent" }, { status: 404 });

  return Response.json({
    intent,
    tierName: intent.tier ? tierSpec(intent.tier).name : null,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await ctx.params;
  const intent = db.payments.find((p) => p.id === id && p.userId === user.id);
  if (!intent) return Response.json({ error: "unknown_intent" }, { status: 404 });

  if (intent.status !== "pending") {
    /* Not an error. A retried callback for an already-settled payment is the
       normal case, and answering 409 would make the browser show a failure for
       money that did arrive. */
    return Response.json({ intent, alreadySettled: true, balanceRial: balanceOf(user.id) });
  }

  const { outcome } = (await req.json().catch(() => ({}))) as {
    outcome?: "paid" | "failed" | "cancelled";
  };

  if (outcome !== "paid") {
    intent.status = outcome === "cancelled" ? "cancelled" : "failed";
    intent.settledAt = new Date().toISOString();
    return Response.json({ intent, balanceRial: balanceOf(user.id) });
  }

  intent.status = "paid";
  intent.settledAt = new Date().toISOString();

  /* Every payment lands in the wallet first, including one opened to buy a
     subscription. The ledger is meant to be readable as a history of the
     account's money, and a subscription charged straight to a card would be a
     month that simply never appears in it. */
  post(user.id, intent.amountRial, "topup", `پرداخت اینترنتی — ${intent.gatewayRef}`);

  if (intent.purpose === "subscription" && intent.tier) {
    const started = startSubscription(user.id, intent.tier);
    if (!started.ok) {
      /* The money is already banked, so this is recoverable rather than lost —
         the wallet holds it and the user can retry. Saying so is better than a
         success screen for a subscription that did not start. */
      return Response.json(
        {
          intent,
          balanceRial: balanceOf(user.id),
          warning: "پرداخت به کیف پول نشست اما اشتراک فعال نشد.",
        },
        { status: 202 },
      );
    }
    return Response.json({
      intent,
      subscription: started.subscription,
      balanceRial: balanceOf(user.id),
    });
  }

  notify(
    user.id,
    "system",
    "کیف پول شارژ شد",
    `${intent.amountRial.toLocaleString("fa-IR")} ریال به کیف پول اضافه شد.`,
    "/wallet",
  );
  return Response.json({ intent, balanceRial: balanceOf(user.id) });
}
