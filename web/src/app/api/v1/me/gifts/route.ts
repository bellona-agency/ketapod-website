import { createGift } from "@/lib/mock/commerce";
import { balanceOf, db, findEditionById } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Gifts this account has sent, and the endpoint that sends one.
 *
 * The claim URL is built on the server and returned whole. It is the only thing
 * the sender needs to forward, and generating it client-side would mean the
 * front end knowing the claim route — which is exactly the kind of contract that
 * quietly breaks the day the route is renamed.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const sent = db.gifts
    .filter((g) => g.fromUserId === user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((g) => {
      const found = findEditionById(g.editionId);
      return {
        ...g,
        bookTitle: found?.book.title ?? "کتاب حذف‌شده",
        bookSlug: found?.book.slug ?? null,
        claimPath: `/gift/${g.code}`,
      };
    });

  const received = db.gifts
    .filter((g) => g.claimedByUserId === user.id)
    .map((g) => ({
      ...g,
      bookTitle: findEditionById(g.editionId)?.book.title ?? "کتاب حذف‌شده",
    }));

  return Response.json({ sent, received });
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    editionId?: string;
    toPhone?: string;
    message?: string;
  };

  if (!body.editionId) return Response.json({ error: "missing_edition" }, { status: 422 });

  /* An optional recipient. Left blank, the link is a bearer token that anyone
     can redeem — which is what someone printing a gift card wants. Filled in,
     the claim is checked against it, which is what someone texting a friend
     wants. Both are legitimate; the sender picks. */
  const toPhone = (body.toPhone ?? "").trim() || null;
  if (toPhone && !/^09\d{9}$/.test(toPhone)) {
    return Response.json(
      { error: "invalid_phone", message: "شماره باید با ۰۹ شروع شود و ۱۱ رقم باشد." },
      { status: 422 },
    );
  }

  const result = createGift(
    auth.user.id,
    body.editionId,
    toPhone,
    (body.message ?? "").trim().slice(0, 280),
  );
  if (!result.ok) {
    const { status, ...payload } = result;
    return Response.json(payload, { status });
  }

  return Response.json(
    {
      gift: result.gift,
      bookTitle: result.book.title,
      claimPath: `/gift/${result.gift.code}`,
      balanceRial: balanceOf(auth.user.id),
    },
    { status: 201 },
  );
}
