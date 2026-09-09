import { balanceOf, db, findEditionById, hasEntitlement, uid } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Buy an edition with wallet credit.
 *
 * This is the endpoint where the spec's two commerce rules meet, and it is
 * written so neither can be bypassed:
 *
 *   * The charge is a *ledger line*, not a decrement of a balance field.
 *   * The access it produces is an *Entitlement*, a separate record with its
 *     own origin — so the same shelf logic serves a purchase, a gift and a
 *     subscription without knowing which happened.
 *
 * Price comes from the edition on the server. Trusting a price from the request
 * body is how a client talks itself into a discount, and the spec already puts
 * every price decision behind the core.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { editionId } = (await req.json().catch(() => ({}))) as {
    editionId?: string;
  };

  const found = editionId ? findEditionById(editionId) : undefined;
  if (!found) {
    return Response.json({ error: "unknown_edition" }, { status: 404 });
  }
  const { edition, book } = found;

  /* Idempotent in the way that matters to a person: a double-submitted buy
     button must not charge twice. A real core would key this on a client-sent
     idempotency token; owning the thing already is the honest check here. */
  if (hasEntitlement(user.id, edition.id)) {
    return Response.json(
      { error: "already_owned", message: "این نسخه از قبل در کتابخانه شماست." },
      { status: 409 },
    );
  }

  const price = edition.priceRial;
  const balance = balanceOf(user.id);

  /* A zero-price edition is included in every tier per the catalogue types, so
     it grants without touching the ledger — a 0-Rial line would be noise in a
     history someone is meant to be able to audit. */
  if (price > 0 && balance < price) {
    return Response.json(
      {
        error: "insufficient_funds",
        message: "موجودی کیف پول کافی نیست.",
        balanceRial: balance,
        requiredRial: price,
        shortfallRial: price - balance,
      },
      { status: 402 },
    );
  }

  const orderId = `ord_${uid()}`;
  const now = new Date().toISOString();

  db.orders.push({
    id: orderId,
    userId: user.id,
    editionId: edition.id,
    priceRial: price,
    status: "paid",
    createdAt: now,
  });

  if (price > 0) {
    db.ledger.push({
      id: `led_${uid()}`,
      userId: user.id,
      amountRial: -price,
      kind: "purchase",
      memo: `خرید ${book.title}`,
      orderId,
      createdAt: now,
    });
  }

  const entitlement = {
    id: `ent_${uid()}`,
    userId: user.id,
    editionId: edition.id,
    source: "purchase" as const,
    grantedAt: now,
    /* A bought book does not expire. Only subscription and org grants do. */
    expiresAt: null,
  };
  db.entitlements.push(entitlement);

  return Response.json(
    { orderId, entitlement, balanceRial: balanceOf(user.id) },
    { status: 201 },
  );
}
