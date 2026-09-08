import { Clock, Mic, Sparkles } from "lucide-react";
import Link from "next/link";
import { CoverArt } from "@/components/primitives/CoverArt";
import {
  bookDialects,
  coverIndex,
  defaultEdition,
  formatDuration,
  formatPrice,
  getAuthor,
  getDialect,
  lowestPrice,
  type Book,
} from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * A book on a shelf.
 *
 * What it shows is decided by the Book/AudioEdition split: the title and author
 * belong to the work, but the duration, the price and the narrator badges all
 * come from its editions — a book with a human reading and an AI reading is one
 * card advertising two things, not two cards.
 *
 * The whole card is one link. An overlay anchor rather than a wrapper, so the
 * markup keeps a real `h3` and the author's name can stay a separate link on
 * the pages that want one.
 */
export function BookCard({ book, className }: { book: Book; className?: string }) {
  const author = getAuthor(book.authorSlug);
  const edition = defaultEdition(book);
  const price = lowestPrice(book);

  const hasHuman = book.editions.some((e) => e.narratorType === "human");
  const hasAi = book.editions.some((e) => e.narratorType === "ai");
  /* `bookDialects` already drops the undefined slugs and deduplicates, which is
     the part TypeScript cannot infer from a `.filter(Boolean)` chain. */
  const dialectTitles = bookDialects(book)
    .map((slug) => getDialect(slug)?.title)
    .filter((title): title is string => Boolean(title));

  return (
    <article className={cn("group lift card relative flex flex-col overflow-hidden", className)}>
      <div className="relative">
        <CoverArt
          src={book.coverUrl}
          alt={`کاور ${book.title}`}
          index={coverIndex(book.slug)}
          rounded="rounded-none"
          className="aspect-square w-full"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
        />

        {/* Free editions are the strongest thing this card can say, so it says
            it over the artwork rather than in the price row at the bottom. */}
        {price === 0 && (
          <span className="absolute right-3 top-3 rounded-full bg-mint px-3 py-1 text-[13px] font-bold text-white shadow-e2">
            رایگان
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="text-[18px] font-bold leading-[1.5] text-ink">
          <Link
            href={routes.book(book.slug)}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {book.title}
          </Link>
        </h3>

        {author && <p className="text-[15px] text-muted">{author.name}</p>}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-[13px] text-faint">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" strokeWidth={1.8} aria-hidden />
            {formatDuration(edition.durationSec)}
          </span>
          {hasHuman && (
            <span className="flex items-center gap-1.5">
              <Mic className="size-3.5" strokeWidth={1.8} aria-hidden />
              گوینده انسانی
            </span>
          )}
          {hasAi && !hasHuman && (
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5" strokeWidth={1.8} aria-hidden />
              روایت هوش مصنوعی
            </span>
          )}
        </div>

        {dialectTitles.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {dialectTitles.map((title) => (
              <li
                key={title}
                className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[12px] font-medium text-violet-700"
              >
                {title}
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-line pt-2.5 text-[15px] font-bold text-ink">
          {/* "از" only when the editions actually differ in price — on a book
              with one edition it would imply a choice that does not exist. */}
          {book.editions.length > 1 && price !== Math.max(...book.editions.map((e) => e.priceRial))
            ? `از ${formatPrice(price)}`
            : formatPrice(price)}
        </p>
      </div>
    </article>
  );
}

/** The shelf itself. One column count for the whole site. */
export function BookGrid({ books, className }: { books: Book[]; className?: string }) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {books.map((book) => (
        <li key={book.slug} className="flex">
          <BookCard book={book} className="w-full" />
        </li>
      ))}
    </ul>
  );
}
