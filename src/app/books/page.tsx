import Link from "next/link";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { CatalogSearch } from "@/components/catalog/CatalogSearch";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { CATEGORIES, COLLECTIONS, allBooks } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "کتاب‌های صوتی",
  description:
    "کاتالوگ کامل کتاب‌های صوتی کتاپاد — ادبیات داستانی، کودک و نوجوان، تاریخ و مدیریت، با انتخاب گوینده و نسخه‌های گویشی.",
  path: routes.books(),
});

/**
 * The catalogue hub.
 *
 * Fully static, and deliberately so: this is the second-most crawled page on
 * the site and the one every category, author and collection link points back
 * through. Search lives at `/search` rather than here, because a page that
 * reads `searchParams` is server-rendered for every visitor — the whole hub
 * would have paid that cost for a parameter most visitors never set.
 */
export default function BooksPage() {
  const books = allBooks();

  return (
    <>
      <PageView name="books" />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌ها", path: routes.books() },
        ]}
        eyebrow="کاتالوگ"
        title="هر کتاب، چند صدا"
        lead="هر اثر می‌تواند چند نسخه صوتی داشته باشد — گوینده انسانی، روایت هوش مصنوعی، یا اجرا به گویش مادری. نسخه را شما انتخاب می‌کنید، نه ما."
        aside={<p className="tnum text-[15px] text-muted">{books.length} عنوان در کاتالوگ</p>}
        below={
          <div className="flex flex-col gap-6">
            <CatalogSearch />

            <ul className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={routes.category(c.slug)}
                    className="inline-flex items-center rounded-full border border-line-2 bg-card px-4 py-2 text-[15px] font-medium text-ink-2 transition-colors duration-200 hover:border-violet hover:bg-violet-50 hover:text-violet"
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <main>
        <section className="section-rhythm pt-12">
          <div className="container-k">
            <Reveal amount={0.05}>
              <BookGrid books={books} />
            </Reveal>
          </div>
        </section>

        {/* Collections are the catalogue's editorial layer — a reading path
            rather than a filter, and each one its own indexable page. */}
        <section className="section-rhythm">
          <div className="container-k">
            <h2 className="text-[27px] font-bold text-ink sm:text-[34px]">مجموعه‌ها</h2>
            <ul className="mt-7 grid gap-4 sm:grid-cols-2">
              {COLLECTIONS.map((collection) => (
                <li key={collection.slug}>
                  <Link
                    href={routes.collection(collection.slug)}
                    className="lift card group flex h-full flex-col gap-2 p-6"
                  >
                    <h3 className="text-[20px] font-bold text-ink transition-colors duration-200 group-hover:text-violet">
                      {collection.title}
                    </h3>
                    <p className="text-[16px] leading-[1.75] text-muted">
                      {collection.description}
                    </p>
                    <p className="tnum mt-auto pt-3 text-[14px] text-faint">
                      {collection.bookSlugs.length} عنوان
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
