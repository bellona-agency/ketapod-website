import { BOOKS, getAuthor } from "@/lib/catalog";
import { db, hasEntitlement } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * The wish list.
 *
 * Keyed on the **book**, not the edition. A listener hearting «بوف کور» is
 * saving the work; which voice they will eventually want to hear it in is a
 * decision they have not made and should not be forced to make in order to
 * remember the book at all. The library, by contrast, is keyed on editions —
 * because owning is about a specific performance.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const rows = db.favourites
    .filter((f) => f.userId === user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const items = rows.flatMap((f) => {
    const book = BOOKS.find((b) => b.slug === f.bookSlug);
    if (!book) return [];
    const cheapest = book.editions.reduce(
      (lo, e) => (lo === null || e.priceRial < lo.priceRial ? e : lo),
      null as (typeof book.editions)[number] | null,
    );
    return [
      {
        bookSlug: book.slug,
        title: book.title,
        subtitle: book.subtitle ?? null,
        author: getAuthor(book.authorSlug)?.name ?? null,
        editionCount: book.editions.length,
        fromRial: cheapest?.priceRial ?? 0,
        /* So the card can say «در کتابخانه شماست» instead of offering to sell
           something the visitor already owns. */
        owned: book.editions.some((e) => hasEntitlement(user.id, e.id)),
        addedAt: f.createdAt,
      },
    ];
  });

  return Response.json({ items, slugs: rows.map((f) => f.bookSlug) });
}

/** Idempotent add — a double-tapped heart is one favourite, not two. */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { bookSlug } = (await req.json().catch(() => ({}))) as { bookSlug?: string };
  if (!bookSlug || !BOOKS.some((b) => b.slug === bookSlug)) {
    return Response.json({ error: "unknown_book" }, { status: 404 });
  }

  const existing = db.favourites.find(
    (f) => f.userId === user.id && f.bookSlug === bookSlug,
  );
  if (existing) return Response.json({ favourite: existing, created: false });

  const row = { userId: user.id, bookSlug, createdAt: new Date().toISOString() };
  db.favourites.push(row);
  return Response.json({ favourite: row, created: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const slug = new URL(req.url).searchParams.get("bookSlug");
  if (!slug) return Response.json({ error: "missing_slug" }, { status: 422 });

  const before = db.favourites.length;
  db.favourites = db.favourites.filter(
    (f) => !(f.userId === auth.user.id && f.bookSlug === slug),
  );
  return Response.json({ ok: db.favourites.length < before });
}
