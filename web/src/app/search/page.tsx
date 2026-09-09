import Link from "next/link";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { CatalogSearch } from "@/components/catalog/CatalogSearch";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { CATEGORIES, searchBooks } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "جست‌وجو",
  description: "جست‌وجو در کاتالوگ کتاب‌های صوتی کتاپاد.",
  path: routes.search(),
  /* Result pages render real content, so a crawler would happily index a
     near-identical variant of the catalogue for every query — competing with
     `/books` itself and with the book pages the results link to. `robots.txt`
     blocks the path; this is the belt to that pair of braces. */
  noIndex: true,
});

/**
 * Search results.
 *
 * The one dynamic route on the site, which is correct: the response depends
 * entirely on a query parameter. Keeping it separate from `/books` is what lets
 * the catalogue hub stay static.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const results = q ? searchBooks(q) : [];

  return (
    <>
      <PageView name="search" metadata={{ query: q }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌ها", path: routes.books() },
          { name: "جست‌وجو", path: routes.search() },
        ]}
        eyebrow="جست‌وجو"
        title={q ? `نتایج «${q}»` : "جست‌وجو در کاتالوگ"}
        lead={
          q
            ? undefined
            : "نام کتاب، نویسنده یا موضوع را بنویسید. برای پرسش به زبان طبیعی، کتاب‌یار را امتحان کنید."
        }
        aside={q ? <p className="tnum text-[15px] text-muted">{results.length} نتیجه</p> : undefined}
        below={<CatalogSearch defaultValue={q} />}
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          {results.length > 0 ? (
            <Reveal amount={0.05}>
              <BookGrid books={results} />
            </Reveal>
          ) : (
            <div className="card p-10 text-center">
              <p className="text-[19px] font-bold text-ink">
                {q ? "چیزی پیدا نشد" : "هنوز چیزی جست‌وجو نکرده‌اید"}
              </p>
              <p className="mx-auto mt-2 max-w-[48ch] text-[16px] leading-[1.8] text-muted">
                عبارت دیگری امتحان کنید، یا از میان دسته‌های زیر شروع کنید. جست‌وجوی معنایی و
                زبان طبیعی در{" "}
                <Link href={routes.ai()} className="font-medium text-violet hover:underline">
                  کتاب‌یار
                </Link>{" "}
                در دسترس است.
              </p>

              <ul className="mt-7 flex flex-wrap justify-center gap-2">
                {CATEGORIES.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={routes.category(category.slug)}
                      className="inline-flex rounded-full border border-line-2 bg-card px-4 py-2 text-[15px] font-medium text-ink-2 transition-colors duration-200 hover:border-violet hover:bg-violet-50 hover:text-violet"
                    >
                      {category.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
