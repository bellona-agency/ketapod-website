import { getAuthor } from "@/lib/catalog";
import { claimGift, normaliseCode } from "@/lib/mock/commerce";
import { db, findEditionById } from "@/lib/mock/db";
import { userFromRequest } from "@/lib/mock/session";

/**
 * Look at a gift, and claim it.
 *
 * GET is deliberately **public**. The spec wants the gift link to work before
 * the recipient has an account — «جریان کاملاً وب‌محور با لینک دریافت» — and a
 * link that shows a login wall before it says what it is asking you to sign up
 * for converts about as well as a blank page. So an anonymous visitor sees the
 * book, the sender's name and the message; claiming it is what needs a session.
 *
 * What GET does *not* reveal is the recipient's phone number, even to someone
 * holding the code. It answers whether the gift is reserved, not for whom.
 */

type Ctx = RouteContext<"/api/v1/gifts/[code]">;

export async function GET(_req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const gift = db.gifts.find((g) => normaliseCode(g.code) === normaliseCode(code));
  if (!gift) return Response.json({ error: "unknown_code" }, { status: 404 });

  const found = findEditionById(gift.editionId);
  return Response.json({
    gift: {
      code: gift.code,
      fromName: gift.fromName,
      message: gift.message,
      claimed: gift.claimedByUserId !== null,
      claimedAt: gift.claimedAt,
      reserved: gift.toPhone !== null,
      createdAt: gift.createdAt,
    },
    book: found
      ? {
          slug: found.book.slug,
          title: found.book.title,
          author: getAuthor(found.book.authorSlug)?.name ?? null,
          durationSec: found.edition.durationSec,
          voiceName: found.voice?.name ?? null,
        }
      : null,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await userFromRequest(req);
  if (!user) {
    /* 401 with the path to come back to. The claim page sends the visitor
       through OTP and returns here, so a brand-new account created at this
       moment lands with the book already on its shelf. */
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { code } = await ctx.params;
  const result = claimGift(user.id, code);
  if (!result.ok) {
    const messages: Record<string, string> = {
      unknown_code: "این کد هدیه معتبر نیست.",
      already_claimed: "این هدیه قبلاً دریافت شده است.",
      own_gift: "هدیه‌ی خودتان را نمی‌توانید دریافت کنید.",
    };
    return Response.json(
      { error: result.error, message: messages[result.error] ?? "دریافت انجام نشد." },
      { status: result.status },
    );
  }

  return Response.json({ ok: true, bookTitle: result.book?.title ?? null });
}
