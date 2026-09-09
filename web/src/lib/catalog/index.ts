import {
  AUTHORS,
  BLOG_POSTS,
  BOOKS,
  CATEGORIES,
  COLLECTIONS,
  DIALECTS,
  PUBLISHERS,
  VOICES,
} from "./data";
import type { AudioEdition, Book, Slug, Voice } from "./types";

export * from "./types";
export {
  AUTHORS,
  BLOG_POSTS,
  BOOKS,
  CATEGORIES,
  COLLECTIONS,
  DIALECTS,
  PUBLISHERS,
  VOICES,
};

/**
 * Read side of the catalogue.
 *
 * Everything is a plain array scan. At this size that is faster than building
 * indexes, and more importantly every one of these functions is a seam: when the
 * Go core exists, each becomes a fetch against `openapi.yaml` with the seed as
 * its fallback, and no page above has to change shape.
 */

/* ── Entity lookup ───────────────────────────────────────────────────────── */

export const getBook = (slug: Slug) => BOOKS.find((b) => b.slug === slug);
export const getAuthor = (slug: Slug) => AUTHORS.find((a) => a.slug === slug);
export const getPublisher = (slug: Slug) => PUBLISHERS.find((p) => p.slug === slug);
export const getCategory = (slug: Slug) => CATEGORIES.find((c) => c.slug === slug);
export const getCollection = (slug: Slug) => COLLECTIONS.find((c) => c.slug === slug);
export const getDialect = (slug: Slug) => DIALECTS.find((d) => d.slug === slug);
export const getBlogPost = (slug: Slug) => BLOG_POSTS.find((p) => p.slug === slug);

export const getVoiceBySlug = (slug: Slug) => VOICES.find((v) => v.slug === slug);

/**
 * The `voices[].id == sources[].voiceId` contract, in one place.
 *
 * Every lookup from an edition to its narrator goes through here, so if the
 * contract is ever broken there is exactly one function to fix rather than a
 * mapping table scattered through the pages.
 */
export const getVoice = (voiceId: string): Voice | undefined =>
  VOICES.find((v) => v.id === voiceId);

/* ── Book collections ────────────────────────────────────────────────────── */

export const allBooks = () => BOOKS;

export const booksByAuthor = (authorSlug: Slug) =>
  BOOKS.filter((b) => b.authorSlug === authorSlug);

export const booksByPublisher = (publisherSlug: Slug) =>
  BOOKS.filter((b) => b.publisherSlug === publisherSlug);

export const booksByCategory = (categorySlug: Slug) =>
  BOOKS.filter((b) => b.categorySlugs.includes(categorySlug));

export const booksInCollection = (collectionSlug: Slug) => {
  const collection = getCollection(collectionSlug);
  if (!collection) return [];
  /* Ordered by the collection, not by the catalogue — a reading path only
     means something in sequence. */
  return collection.bookSlugs
    .map(getBook)
    .filter((b): b is Book => Boolean(b));
};

/** Books with at least one edition performed in this dialect. */
export const booksByDialect = (dialectSlug: Slug) =>
  BOOKS.filter((b) => b.editions.some((e) => e.dialectSlug === dialectSlug));

/** Books with at least one edition narrated by this voice. */
export const booksByVoice = (voiceId: string) =>
  BOOKS.filter((b) => b.editions.some((e) => e.voiceId === voiceId));

/**
 * The kids catalogue.
 *
 * Approved-only, per the spec's kids rule — a book qualifies through an
 * edition that is itself marked kid-safe, never through its category alone.
 * A children's classic with only an adult narration does not belong here.
 */
export const kidsBooks = () => BOOKS.filter((b) => b.editions.some((e) => e.isKidsFriendly));

/* ── Editions ────────────────────────────────────────────────────────────── */

/**
 * The edition a page shows when the reader has not chosen one.
 *
 * Human narration first, then the longest — a full performance rather than an
 * abridged one. Never returns undefined: a book without editions is a data
 * error, and the types say `editions` is non-empty.
 */
export function defaultEdition(book: Book): AudioEdition {
  const human = book.editions.filter((e) => e.narratorType === "human");
  const pool = human.length > 0 ? human : book.editions;
  return pool.reduce((best, e) => (e.durationSec > best.durationSec ? e : best), pool[0]);
}

/** The edition a kids surface shows. Falls back to nothing rather than to an adult one. */
export const kidsEdition = (book: Book) => book.editions.find((e) => e.isKidsFriendly);

export const findEdition = (book: Book, editionId: string) =>
  book.editions.find((e) => e.id === editionId);

/** Dialect slugs this book has been performed in, deduplicated. */
export const bookDialects = (book: Book) => [
  ...new Set(book.editions.map((e) => e.dialectSlug).filter((d): d is Slug => Boolean(d))),
];

/** Lowest price across editions — what a catalogue card shows as "از …". */
export const lowestPrice = (book: Book) =>
  Math.min(...book.editions.map((e) => e.priceRial));

/**
 * Palette index for `CoverArt`'s stand-in artwork.
 *
 * Derived from the book's position in the catalogue rather than from its
 * position in whatever list is being rendered, so a book keeps the same drawn
 * cover on the shelf, on its own page and in a collection. Clamped because a
 * missing slug would otherwise index the palette array with -1.
 */
export const coverIndex = (slug: Slug) => Math.max(0, BOOKS.findIndex((b) => b.slug === slug));

/* ── Ratings ─────────────────────────────────────────────────────────────── */

/**
 * Mean rating and count, or null when a book has no reviews yet.
 *
 * Null rather than zero on purpose: `schema.org/AggregateRating` with a
 * `ratingValue` of 0 is a claim that the book is rated badly, not a claim that
 * it is unrated, and search engines will render it as stars.
 */
export function aggregateRating(book: Book) {
  if (book.reviews.length === 0) return null;
  const total = book.reviews.reduce((sum, r) => sum + r.rating, 0);
  return {
    value: total / book.reviews.length,
    count: book.reviews.length,
  };
}

/* ── Search ──────────────────────────────────────────────────────────────—
   Substring matching over title, author and category. Deliberately naive: the
   spec puts real search in Postgres FTS and then Meilisearch, and a clever
   client-side ranking here would only be thrown away — and would hide the fact
   that typo tolerance for Persian is a server concern.                       */

export function searchBooks(query: string) {
  const q = query.trim();
  if (!q) return BOOKS;

  return BOOKS.filter((book) => {
    const author = getAuthor(book.authorSlug)?.name ?? "";
    const categories = book.categorySlugs
      .map((s) => getCategory(s)?.title ?? "")
      .join(" ");
    return `${book.title} ${book.subtitle ?? ""} ${author} ${categories}`.includes(q);
  });
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

/**
 * "۴ ساعت و ۱۵ دقیقه" — spelled out rather than `4:15`, which reads as a
 * timestamp. Digits stay Latin in the source and IRANYekan's `locl` renders
 * them Persian, matching the body copy around them.
 */
export function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} دقیقه`;
  if (minutes === 0) return `${hours} ساعت`;
  return `${hours} ساعت و ${minutes} دقیقه`;
}

/** ISO 8601 duration, for `schema.org`. Machine-facing, so no localisation. */
export function isoDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `PT${hours > 0 ? `${hours}H` : ""}${minutes}M`;
}

/**
 * Prices are stored in Rial and shown in Toman, because that is the unit
 * Iranian shoppers actually quote. Free editions say so rather than showing 0.
 */
export function formatPrice(rial: number) {
  if (rial === 0) return "رایگان";
  return `${Math.round(rial / 10).toLocaleString("fa-IR")} تومان`;
}

/** Persian calendar date from an ISO string, for blog posts and reviews. */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fa-IR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const NARRATOR_LABEL: Record<"human" | "ai", string> = {
  human: "گوینده انسانی",
  ai: "روایت هوش مصنوعی",
};
