/**
 * Catalogue domain types.
 *
 * These mirror the entities in the technical spec's data model section, and the
 * split it insists on is the one thing worth preserving above all others:
 *
 *   Book          the abstract work — title, author, publisher, reference text.
 *                 **No audio lives here.**
 *   AudioEdition  one *performance* of that work — a voice, a dialect, a
 *                 narrator type, its own price, its own kids flag.
 *
 * Every downstream feature the spec lists (dialects, the voice marketplace, a
 * human and an AI reading side by side, per-edition pricing) exists only
 * because those two are separate records. Collapsing them back into one "book
 * with an audio file" is the single change that would make the rest impossible,
 * so the seed data and every page below are written against this shape rather
 * than against whatever is convenient for one screen.
 *
 * `ListeningPosition` and `Entitlement` are deliberately absent: they belong to
 * the authenticated web app, and nothing on the public, indexable surface may
 * depend on them.
 */

/** Slugs are the URL identity of everything here — one per indexable page. */
export type Slug = string;

export type NarratorType = "human" | "ai";

export interface Author {
  slug: Slug;
  name: string;
  /** Latin transliteration, for `schema.org` and `hreflang` variants. */
  nameLatin?: string;
  bio: string;
  birthYear?: number;
  deathYear?: number;
}

export interface Publisher {
  slug: Slug;
  name: string;
  bio: string;
  foundedYear?: number;
}

export interface Category {
  slug: Slug;
  title: string;
  /** One line, used as the category page's meta description. */
  description: string;
  icon: string;
}

/**
 * A curated set of works — "مجموعه" in the spec's surface map.
 *
 * Cheap indexable pages: they carry real editorial copy and link out to a dozen
 * book pages each, which is exactly the internal-linking shape a new catalogue
 * needs before it has any external authority.
 */
export interface Collection {
  slug: Slug;
  title: string;
  description: string;
  /** Book slugs, in the order the collection is meant to be read. */
  bookSlugs: Slug[];
}

/**
 * A regional language or dialect.
 *
 * The spec gives each one its own landing page for two reasons — organic
 * traffic, and raw material for press. Both need the page to be real editorial
 * content, not a filtered catalogue view with a heading swapped in, so this
 * carries its own copy.
 */
export interface Dialect {
  slug: Slug;
  /** Endonym — what speakers call it. */
  title: string;
  /** Where it is spoken, for the landing page's subheading. */
  region: string;
  description: string;
  /** BCP-47, for `lang` on any sample text set in this dialect. */
  bcp47: string;
  speakerEstimate: string;
}

/**
 * A narrator — human or synthetic.
 *
 * The spec asks for `/voice/[slug]` as its own indexable page on the grounds
 * that a well-known narrator's name is a high-volume search query, so a voice
 * is a first-class record with a biography, not a label on an edition.
 */
export interface Voice {
  /**
   * The id half of the spec's `voices[].id == sources[].voiceId` contract.
   *
   * The design document defined it, the spec calls it correct, and it is what
   * keeps the front end from ever hand-mapping a chosen voice onto a real audio
   * source. `AudioEdition.voiceId` is the only thing allowed to point here.
   */
  id: string;
  slug: Slug;
  name: string;
  type: NarratorType;
  /** Short descriptor shown next to the name: "روایت گرم و آرام". */
  timbre: string;
  bio: string;
  /** Dialect slug, when the voice performs in one. */
  dialectSlug?: Slug;
  /** Set on voices cleared for the kids catalogue. */
  kidsApproved: boolean;
}

/** One chapter's boundaries within an edition, in seconds. */
export interface Chapter {
  index: number;
  title: string;
  startSec: number;
  endSec: number;
}

/**
 * A sentence-level transcript cue.
 *
 * The spec calls the time-aligned transcript the project's most valuable
 * technical asset because one structure does four jobs: accessibility, indexable
 * text, text/audio sync, and RAG context for the assistant. The public book page
 * uses it for the second of those — a real excerpt of the book's own words, in
 * the HTML, for every edition.
 */
export interface TranscriptCue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * One performance of a Book.
 *
 * Price sits here rather than on the book because the spec's marketplace has an
 * AI reading and a human reading of the same work at different prices, and a
 * dialect edition priced differently again.
 */
export interface AudioEdition {
  id: string;
  /** Holds the `voices[].id == sources[].voiceId` contract. */
  voiceId: string;
  narratorType: NarratorType;
  dialectSlug?: Slug;
  /** Rial. Zero means the edition is included in every subscription tier. */
  priceRial: number;
  durationSec: number;
  isKidsFriendly: boolean;
  chapters: Chapter[];
  /** A short, indexable excerpt — not the whole transcript. */
  transcriptSample: TranscriptCue[];
}

export interface Review {
  id: string;
  author: string;
  /** 1–5, whole stars. Mapped straight onto `schema.org/Review`. */
  rating: number;
  body: string;
  /** ISO date. */
  date: string;
}

export interface Book {
  slug: Slug;
  title: string;
  subtitle?: string;
  /** Original title, when the work is a translation. */
  originalTitle?: string;
  authorSlug: Slug;
  translator?: string;
  publisherSlug: Slug;
  categorySlugs: Slug[];
  /** Long-form, indexable. This is the page's actual content. */
  description: string;
  /** Assistant-generated chapter summary the spec asks to publish publicly. */
  summary: string;
  publishedYear: number;
  isbn?: string;
  language: string;
  /** Every performance of this work. Never empty. */
  editions: AudioEdition[];
  reviews: Review[];
  /** Absent until real cover art exists; `CoverArt` draws a stand-in. */
  coverUrl?: string;
}

export interface BlogPost {
  slug: Slug;
  title: string;
  excerpt: string;
  /** Markdown-free paragraphs, kept as an array so the page can set them. */
  body: string[];
  author: string;
  /** ISO date. */
  date: string;
  readingMinutes: number;
  tag: string;
}
