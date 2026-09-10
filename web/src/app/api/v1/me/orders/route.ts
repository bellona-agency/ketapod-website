import {
  REFUND_MAX_PROGRESS,
  REFUND_WINDOW_DAYS,
  refundOrder,
} from "@/lib/mock/commerce";
import { db, findEditionById } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Purchase history, and the refund button on it.
 *
 * `refundable` is computed on the server and sent as a boolean with a reason.
 * The front end could in principle work it out — it has the date and the
 * position — but then the seven-day window and the ten-percent threshold would
 * exist in two places, and the day one of them changed the button would offer
 * something the endpoint refuses.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const orders = db.orders
    .filter((o) => o.userId === user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((o) => {
      const found = findEditionById(o.editionId);
      const position = db.positions.find(
        (p) => p.userId === user.id && p.editionId === o.editionId,
      );
      const progress =
        position && found ? position.positionSec / found.edition.durationSec : 0;
      const ageDays = (Date.now() - Date.parse(o.createdAt)) / 86_400_000;

      let reason: string | null = null;
      if (o.status === "refunded") reason = "بازپرداخت شده";
      else if (ageDays > REFUND_WINDOW_DAYS) reason = `مهلت ${REFUND_WINDOW_DAYS} روزه گذشته`;
      else if (progress > REFUND_MAX_PROGRESS)
        reason = `بیش از ${Math.round(REFUND_MAX_PROGRESS * 100)}٪ شنیده شده`;

      return {
        ...o,
        bookSlug: found?.book.slug ?? null,
        bookTitle: found?.book.title ?? "کتاب حذف‌شده",
        voiceName: found?.voice?.name ?? null,
        progress: Math.round(progress * 100),
        refundable: reason === null,
        refundBlockedBecause: reason,
      };
    });

  return Response.json({
    orders,
    policy: {
      windowDays: REFUND_WINDOW_DAYS,
      maxProgressPercent: Math.round(REFUND_MAX_PROGRESS * 100),
    },
  });
}

/** Refund one order. The id is in the body, not the path — this is a command
 *  against the collection, not an edit of a resource. */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId) return Response.json({ error: "missing_order" }, { status: 422 });

  const result = refundOrder(auth.user.id, orderId);
  if (!result.ok) {
    const { status, ...payload } = result;
    return Response.json(payload, { status });
  }
  return Response.json({ order: result.order, balanceRial: result.balanceRial });
}
