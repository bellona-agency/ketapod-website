import { pendingDiscount, redeem } from "@/lib/mock/commerce";
import { balanceOf } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * One box, three kinds of code.
 *
 * A percentage code, a gift card and a voucher are one thing to the person
 * holding them — a string off a poster or a text message — and three things
 * only to the ledger. Splitting them across endpoints would push that
 * distinction onto the user, who has no way to tell which kind they were given.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  return Response.json({ pending: pendingDiscount(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const result = redeem(auth.user.id, code ?? "");

  if (!result.ok) {
    const { status, ...payload } = result;
    return Response.json(payload, { status });
  }
  return Response.json({ ...result, balanceRial: balanceOf(auth.user.id) });
}
