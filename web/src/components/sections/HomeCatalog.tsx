import Link from "next/link";
import { BookCard } from "@/components/catalog/BookCard";
import { RailNudge } from "@/components/primitives/RailNudge";
import { Reveal } from "@/components/primitives/Reveal";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { DIALECTS, allBooks, booksByDialect } from "@/lib/catalog";
import { routes } from "@/lib/routes";

/**
 * The catalogue, on the home page.
 *
 * Two jobs, and the second is the one that justifies the section. Visibly, it
 * turns an abstract pitch into a shelf of real books with real narrators. Less
 * visibly, it is the home page's only link into `/books`, `/book/…` and every
 * dialect page — and the home page is the one URL that will accumulate external
 * links, so it is where crawl depth is decided for the whole catalogue.
 *
 * A rail rather than a grid: this is a sample, and a grid would promise
 * completeness the section is not delivering.
 */
export function HomeCatalog() {
  /* Six is what fits a rail without the last card being a sliver on any
     breakpoint the page supports. */
  const featured = allBooks().slice(0, 6);

  return (
    <section id="catalog" className="section-rhythm">
      <div className="container-k">
        <SectionHeading
          index="02"
          eyebrow="Catalogue"
          title="هر کتاب، چند صدا"
          lead="یک اثر می‌تواند با گوینده انسانی، با روایت هوش مصنوعی، یا به گویش مادری اجرا شود — با قیمت و طول مستقل. نسخه را شنونده انتخاب می‌کند."
          split
          action={
            <div className="flex items-center gap-3">
              <RailNudge prevLabel="کتاب قبلی" nextLabel="کتاب بعدی" />
              <Link href={routes.books()} className="btn btn-ghost">
                همه کتاب‌ها
              </Link>
            </div>
          }
        />
      </div>

      {/* Full-bleed: the rail starts on the page grid and runs off the far edge,
          which is what makes it read as "there is more" rather than as a
          truncated row. */}
      <Reveal amount={0.05} className="mt-9">
        <ul
          data-rail
          className="rail-bleed no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
        >
          {featured.map((book) => (
            <li key={book.slug} className="w-[220px] shrink-0 snap-start sm:w-[248px]">
              <BookCard book={book} className="h-full" />
            </li>
          ))}
        </ul>
      </Reveal>

      {/* The dialect pages, linked from the home page. Each is a landing page
          for a query almost nobody else has content for. */}
      <div className="container-k mt-10">
        <p className="text-[16px] text-muted">به زبان مادری:</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {DIALECTS.map((dialect) => (
            <li key={dialect.slug}>
              <Link
                href={routes.dialect(dialect.slug)}
                className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-card px-4 py-2 text-[15px] font-medium text-ink-2 transition-colors duration-200 hover:border-violet hover:bg-violet-50 hover:text-violet"
              >
                {dialect.title}
                <span className="tnum text-[13px] text-faint">
                  {booksByDialect(dialect.slug).length}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
