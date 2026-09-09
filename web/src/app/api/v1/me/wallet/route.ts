import { balanceOf, db, uid } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * The wallet: a derived balance over an append-only ledger.
 *
 * The spec's instruction is blunt — "دفتر کل فقط‌افزودنی نوشته شود نه یک فیلد
 * balance" — and the reason is that a refund, a revenue split with a narrator
 * and an audit all need the history, while a `balance` column can drift from it
 * with no way to tell which is right. So there is no balance to update here:
 * top-ups and purchases both append, and the number is summed on read.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const entries = db.ledger
    .filter((l) => l.userId === user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return Response.json({
    balanceRial: balanceOf(user.id),
    entries,
  });
}

/**
 * Top up.
 *
 * Stands in for the گیت‌وی. The spec routes real charging through Zarinpal or a
 * bank gateway with a callback, so the shape kept here is the one that survives
 * that change: the client asks for an amount, the server appends a line and
 * answers with the new balance. When a gateway arrives it goes between those
 * two steps and nothing above this endpoint moves.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { amountRial } = (await req.json().catch(() => ({}))) as {
    amountRial?: number;
  };

  const amount = Math.floor(amountRial ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json(
      { error: "invalid_amount", message: "مبلغ معتبر نیست." },
      { status: 422 },
    );
  }
  if (amount > 50_000_000) {
    return Response.json(
      { error: "amount_too_large", message: "سقف هر شارژ ۵ میلیون تومان است." },
      { status: 422 },
    );
  }

  const entry = {
    id: `led_${uid()}`,
    userId: user.id,
    amountRial: amount,
    kind: "topup" as const,
    memo: "شارژ کیف پول",
    createdAt: new Date().toISOString(),
  };
  db.ledger.push(entry);

  return Response.json({ entry, balanceRial: balanceOf(user.id) });
}
