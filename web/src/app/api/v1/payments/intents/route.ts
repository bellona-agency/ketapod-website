import { TIERS } from "@/lib/mock/commerce";
import { db, uid, type SubscriptionTier } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Open a payment at the gateway.
 *
 * The spec routes money through Zarinpal or a bank PSP, and every one of them
 * has the same shape: you register an amount, you get a token, you send the
 * browser to the bank, the bank sends it back with a result, and you verify
 * that result server-side before crediting anything.
 *
 * That shape is what this endpoint exists to preserve. The mock's "bank" is a
 * page at `/pay/[id]` instead of a real one, but the intent row, the redirect
 * and the server-side settlement are all real — so swapping in Zarinpal is
 * replacing the middle step, not rebuilding the flow.
 *
 * The amount is fixed *here*, at the moment the intent is created, and the
 * settle handler reads it back from the row. A callback that carried its own
 * amount would let anyone finish a 10,000-Rial payment as 10,000,000.
 */

const MIN_RIAL = 100_000;
const MAX_RIAL = 50_000_000;

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    purpose?: "topup" | "subscription";
    amountRial?: number;
    tier?: SubscriptionTier;
    returnPath?: string;
  };

  const purpose: "topup" | "subscription" =
    body.purpose === "subscription" ? "subscription" : "topup";
  let amount: number;
  let tier: SubscriptionTier | null = null;

  if (purpose === "subscription") {
    const spec = TIERS.find((t) => t.id === body.tier);
    if (!spec) {
      return Response.json({ error: "unknown_tier" }, { status: 422 });
    }
    tier = spec.id;
    amount = spec.monthlyRial;
  } else {
    amount = Math.floor(body.amountRial ?? 0);
    if (!Number.isFinite(amount) || amount < MIN_RIAL || amount > MAX_RIAL) {
      return Response.json(
        { error: "invalid_amount", message: "مبلغ بین ۱۰ هزار تا ۵ میلیون تومان باشد." },
        { status: 422 },
      );
    }
  }

  /* Only same-site paths. `returnPath` comes back as a redirect target, and an
     absolute URL here would turn the payment flow into an open redirect that a
     phishing page could borrow the bank's credibility from. */
  const raw = body.returnPath ?? "/wallet";
  const returnPath = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/wallet";

  const intent = {
    id: `pay_${uid()}`,
    userId: user.id,
    amountRial: amount,
    purpose,
    tier,
    status: "pending" as const,
    gatewayRef: `KP${Date.now().toString().slice(-9)}`,
    returnPath,
    createdAt: new Date().toISOString(),
    settledAt: null,
  };
  db.payments.push(intent);

  return Response.json(
    { intent, redirectUrl: `/pay/${intent.id}` },
    { status: 201 },
  );
}
