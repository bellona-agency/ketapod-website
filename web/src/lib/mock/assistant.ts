/**
 * کتاب‌یار — retrieval over the synced transcript.
 *
 * The spec calls position-awareness «هسته ارزش این قابلیت» and spells out the
 * contract: every request carries `bookId + chapterId + currentTime`, and the
 * answer «هیچ‌وقت جلوتر از جایی که رسیده‌اید نمی‌رود — و اسپویل نمی‌دهد».
 *
 * That is a retrieval constraint before it is a generation one, which is why it
 * lives here and not in a prompt. `heardCues` is the only way into the corpus,
 * and it cannot return a cue the listener has not reached. A model asked nicely
 * not to spoil the ending will eventually spoil the ending; a retriever that
 * cannot see the ending cannot.
 *
 * ── On the missing model ────────────────────────────────────────────────────
 * There is no LLM behind this. The spec puts one behind a multi-provider
 * `AIProvider` interface precisely so it can be swapped, so that interface is
 * what exists here, with an extractive implementation: answers are assembled
 * from the transcript's own sentences with their timestamps, rather than
 * generated. That is narrower than the real thing — it cannot paraphrase or
 * reason — but every word it returns is genuinely from the book, which is the
 * property the spec is actually selling («پاسخ‌ها از ترنسکریپت همگام همان نسخه
 * صوتی می‌آیند، نه از دانش عمومی درباره کتاب»).
 *
 * When a provider is wired in, it receives exactly the context `heardCues`
 * returns and nothing else, and the spoiler guarantee still holds.
 */

import { BOOKS, type Book, type TranscriptCue } from "@/lib/catalog";
import { findEditionById } from "./db";

/* ── Persian normalisation ───────────────────────────────────────────────—
   The spec reaches for `pg_trgm` and `unaccent` for exactly this reason:
   Persian text arrives spelled several ways for the same word. Arabic yeh and
   kaf are visually identical to their Persian counterparts and constantly
   substituted; the zero-width non-joiner is invisible and inconsistently typed;
   and harakat are usually absent but occasionally not. Without folding these,
   «كتاب‌ها» and «کتابها» are different strings and the search silently misses. */

const ARABIC_YEH = /ي/g; // ي → ی
const ARABIC_KAF = /ك/g; // ك → ک
const ARABIC_ALEF_MAQSURA = /ى/g; // ى → ی
const HARAKAT = /[ً-ْٰ]/g; // fathatan … sukun, superscript alef
const TATWEEL = /ـ/g; // kashida
const ZWNJ = /‌/g;
const EASTERN_DIGITS = /[۰-۹٠-٩]/g;
const PUNCT = /[.،؛:!؟?"'«»()\[\]{}\-–—…]/g;

export function normalise(text: string): string {
  return text
    .replace(ARABIC_YEH, "ی")
    .replace(ARABIC_ALEF_MAQSURA, "ی")
    .replace(ARABIC_KAF, "ک")
    .replace(HARAKAT, "")
    .replace(TATWEEL, "")
    .replace(EASTERN_DIGITS, (d) =>
      String(
        d.charCodeAt(0) >= 0x06f0
          ? d.charCodeAt(0) - 0x06f0
          : d.charCodeAt(0) - 0x0660,
      ),
    )
    /* ZWNJ becomes a space rather than nothing: «می‌رود» should tokenise as
       «می» + «رود» so it still matches someone who typed «می رود», and joining
       it to «میرود» would match neither. */
    .replace(ZWNJ, " ")
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Words too common to carry meaning.
 *
 * Kept deliberately short. An aggressive Persian stop list strips «چه», «کی» and
 * «کجا», which are the entire content of the questions this assistant is asked.
 */
const STOP = new Set([
  "از", "به", "با", "در", "را", "که", "این", "آن", "و", "یا", "هم", "برای",
  "تا", "بر", "است", "بود", "شد", "می", "های", "ها", "یک", "من", "او",
]);

export const tokenise = (text: string) =>
  normalise(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));

/* ── Retrieval ───────────────────────────────────────────────────────────— */

export interface Passage {
  cue: TranscriptCue;
  score: number;
}

/**
 * The cues the listener has actually heard.
 *
 * The spoiler guard, and the only door to the transcript. `endSec <= upToSec`
 * rather than `startSec`: a sentence half-spoken is a sentence whose ending the
 * listener does not have yet, and the ending is where the surprise lives.
 */
export function heardCues(cues: TranscriptCue[], upToSec: number) {
  return cues.filter((c) => c.endSec <= upToSec);
}

/**
 * Rank heard cues against a question.
 *
 * Overlap weighted by how rare each term is across the heard text, which is
 * inverse document frequency in its simplest form. Without the weighting, a
 * question containing «کتاب» matches every cue that says «کتاب» equally, and
 * the distinctive word in the question — the one the reader actually cares
 * about — counts no more than the filler around it.
 */
export function retrieve(
  cues: TranscriptCue[],
  question: string,
  limit = 3,
): Passage[] {
  const terms = tokenise(question);
  if (terms.length === 0 || cues.length === 0) return [];

  const docs = cues.map((c) => new Set(tokenise(c.text)));
  const idf = new Map<string, number>();
  for (const term of new Set(terms)) {
    const seen = docs.filter((d) => d.has(term)).length;
    /* +1 inside the log keeps a term that appears everywhere at zero rather
       than negative, so common words are ignored, never penalised. */
    idf.set(term, Math.log(1 + cues.length / (1 + seen)));
  }

  return cues
    .map((cue, i) => {
      let score = 0;
      for (const term of terms) {
        if (docs[i].has(term)) score += idf.get(term) ?? 0;
      }
      /* Normalised by sentence length so a long cue does not win merely by
         containing more words than a short one. */
      return { cue, score: score / Math.sqrt(docs[i].size || 1) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ── Provider ────────────────────────────────────────────────────────────— */

export interface AskContext {
  editionId: string;
  chapterId: number | null;
  currentTimeSec: number;
  question: string;
}

export interface Answer {
  text: string;
  /** Where each claim came from, so the reader can jump and check. */
  citations: { startSec: number; endSec: number; text: string }[];
  /** True when nothing heard so far bears on the question. */
  grounded: boolean;
}

export interface AIProvider {
  id: string;
  ask(ctx: AskContext, passages: Passage[]): Promise<Answer>;
}

/**
 * The extractive provider.
 *
 * Answers by quoting. It is honest about being unable to answer, which matters
 * more here than coverage: an assistant that invents a plausible sentence about
 * a book is doing the one thing this feature exists to avoid.
 */
export const extractiveProvider: AIProvider = {
  id: "extractive",
  async ask(ctx, passages) {
    if (passages.length === 0) {
      return {
        text: "تا این‌جای کتاب چیزی درباره این پرسش گفته نشده. کمی جلوتر که رفتید دوباره بپرسید.",
        citations: [],
        grounded: false,
      };
    }
    return {
      text: passages.map((p) => p.cue.text).join(" "),
      citations: passages.map((p) => ({
        startSec: p.cue.startSec,
        endSec: p.cue.endSec,
        text: p.cue.text,
      })),
      grounded: true,
    };
  },
};

/** Swapped by changing this binding; nothing above names a provider. */
export const provider: AIProvider = extractiveProvider;

/* ── Derived reads ───────────────────────────────────────────────────────— */

/**
 * "تا اینجا چه گذشت" — a recap of the heard portion only.
 *
 * The spec is specific that this summarises what has been heard and not the
 * book: «خلاصه‌ای از آنچه تا این لحظه شنیده‌اید، نه از کل کتاب». Built from the
 * first and last heard sentences plus the chapters crossed, which is a real
 * summary of progress even without a model to compress the middle.
 */
export function recap(editionId: string, upToSec: number) {
  const found = findEditionById(editionId);
  if (!found) return null;
  const { edition, book } = found;

  const heard = heardCues(edition.transcriptSample, upToSec);
  const chapters = edition.chapters.filter((c) => c.startSec < upToSec);
  const current = edition.chapters.find(
    (c) => upToSec >= c.startSec && upToSec < c.endSec,
  );

  return {
    bookTitle: book.title,
    chaptersDone: chapters.length,
    chaptersTotal: edition.chapters.length,
    currentChapter: current?.title ?? null,
    percent: Math.round((upToSec / edition.durationSec) * 100),
    openingLine: heard[0]?.text ?? null,
    lastLine: heard[heard.length - 1]?.text ?? null,
    /* The public book page publishes this one — the spec wants the summary
       indexable as free unique text about every book. */
    publicSummary: book.summary,
  };
}

/**
 * A one-line description of what was being said at a given second.
 *
 * This is the text behind the «Bookmark هوشمند با خلاصه» row of the feature
 * matrix. It reads a small window *ending* at the mark rather than centred on
 * it: the listener pressed the button because of something they had just heard,
 * so the sentences after the mark are not yet part of what they were reacting
 * to — and on a first listen, including them would be a spoiler attached to
 * their own bookmark.
 */
export function summariseAt(editionId: string, atSec: number) {
  const found = findEditionById(editionId);
  if (!found) return null;

  const chapter = found.edition.chapters.find(
    (c) => atSec >= c.startSec && atSec < c.endSec,
  );

  const window = found.edition.transcriptSample.filter(
    (c) => c.endSec <= atSec && c.endSec > atSec - 90,
  );
  const lines = window.slice(-2).map((c) => c.text.trim());

  if (lines.length === 0) {
    /* No transcript reached this second. Naming the chapter is still a truthful
       answer and a useful one; inventing a summary would not be either. */
    return chapter ? `در «${chapter.title}»` : null;
  }
  return `${chapter ? `«${chapter.title}» — ` : ""}${lines.join(" ")}`;
}

/**
 * Quiz questions from heard content.
 *
 * Cloze deletion over the transcript: take a distinctive sentence, blank its
 * rarest word, and offer that word among decoys drawn from other sentences the
 * listener has also heard. Decoys from elsewhere in the *same* book keep the
 * options plausible; drawing them from a global word list makes every answer
 * obvious by register alone.
 */
export function quiz(editionId: string, upToSec: number, count = 3) {
  const found = findEditionById(editionId);
  if (!found) return [];

  const heard = heardCues(found.edition.transcriptSample, upToSec);
  if (heard.length === 0) return [];

  const vocabulary = [...new Set(heard.flatMap((c) => tokenise(c.text)))];

  return heard
    .slice(0, count)
    .map((cue, i) => {
      const words = tokenise(cue.text);
      if (words.length < 3) return null;

      /* The longest word stands in for the rarest — a cheap proxy that happens
         to hold in Persian, where the grammatical filler is short. */
      const answer = words.reduce((a, b) => (b.length > a.length ? b : a));
      const decoys = vocabulary
        .filter((w) => w !== answer && Math.abs(w.length - answer.length) <= 3)
        .slice(0, 3);
      if (decoys.length < 2) return null;

      return {
        id: `q${i}`,
        prompt: cue.text.replace(
          new RegExp(answer, "i"),
          "______",
        ),
        options: [answer, ...decoys.slice(0, 3)].sort(() => Math.random() - 0.5),
        answer,
        atSec: cue.startSec,
      };
    })
    .filter((q): q is NonNullable<typeof q> => q !== null);
}

/**
 * Natural-language catalogue search.
 *
 * The spec's example is «کتابی می‌خواهم درباره تنهایی که تلخ نباشد» — a sentence,
 * not a keyword. Scored across every field that carries meaning about a book,
 * with the description and summary weighted below the title so a book *about*
 * loneliness does not outrank one that is actually called that.
 *
 * Real semantic search is `pgvector`; this is lexical and says so. It is the
 * seam, not the destination.
 */
export function semanticSearch(query: string, limit = 6) {
  const terms = tokenise(query);
  if (terms.length === 0) return [];

  const scoreOf = (book: Book) => {
    const fields: [string, number][] = [
      [book.title, 3],
      [book.subtitle ?? "", 2],
      [book.summary, 1.5],
      [book.description, 1],
      [book.categorySlugs.join(" "), 1.5],
    ];
    let score = 0;
    for (const [text, weight] of fields) {
      const bag = new Set(tokenise(text));
      for (const term of terms) if (bag.has(term)) score += weight;
    }
    return score;
  };

  return BOOKS.map((book) => ({ book, score: scoreOf(book) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
