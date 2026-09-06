import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { DIALECTS, VOICES, booksByDialect } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "گویش‌ها و زبان‌های ایرانی",
  description:
    "کتاب صوتی به گیلکی، کوردی کرمانجی، ترکی آذربایجانی، لری و بلوچی — ادبیات شفاهی ایران، در قالبی که در آن زیسته است.",
  path: routes.dialects(),
});

/**
 * The dialect hub.
 *
 * Each language below gets its own landing page, which is the spec's
 * instruction and is right for two reasons at once: these are near-zero
 * competition search queries, and the catalogue is genuinely different per
 * language rather than being the same books with a label swapped.
 */
export default function DialectsPage() {
  return (
    <>
      <PageView name="dialects" />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "گویش‌ها", path: routes.dialects() },
        ]}
        eyebrow="زبان مادری"
        title="ادبیاتی که هرگز نوشته نشد"
        lead="بخش بزرگی از ادبیات ایران هیچ‌وقت مکتوب نشده و فقط در اجرای زنده منتقل شده است. برای این ادبیات، صوت قالب دوم نیست — قالب اصلی است. کاتالوگ گویش‌های کتاپاد از همین‌جا شروع می‌شود."
        aside={<p className="tnum text-[15px] text-muted">{DIALECTS.length} زبان و گویش</p>}
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <RevealGroup className="grid gap-4 md:grid-cols-2" stagger={0.06} amount={0.05}>
            {DIALECTS.map((dialect) => {
              const books = booksByDialect(dialect.slug);
              const voices = VOICES.filter((v) => v.dialectSlug === dialect.slug);

              return (
                <RevealItem key={dialect.slug}>
                  <Link
                    href={routes.dialect(dialect.slug)}
                    className="lift card group flex h-full flex-col gap-3 p-6 sm:p-7"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="text-[24px] font-bold text-ink transition-colors duration-200 group-hover:text-violet">
                        {dialect.title}
                      </h2>
                      <span className="tnum shrink-0 text-[14px] text-faint">
                        {dialect.speakerEstimate}
                      </span>
                    </div>

                    <p className="text-[15px] font-medium text-violet-700">{dialect.region}</p>

                    <p className="text-[16px] leading-[1.8] text-muted">{dialect.description}</p>

                    <p className="tnum mt-auto border-t border-line pt-4 text-[14px] text-faint">
                      {books.length} اثر · {voices.length} گوینده
                    </p>
                  </Link>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </div>
      </main>
    </>
  );
}
