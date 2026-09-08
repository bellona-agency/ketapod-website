import { Mic } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { DIALECTS, VOICES, booksByDialect, getDialect } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return DIALECTS.map((dialect) => ({ slug: dialect.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dialect = getDialect(slug);
  if (!dialect) return {};

  return pageMetadata({
    title: `کتاب صوتی ${dialect.title}`,
    description: `${dialect.description.slice(0, 150)}… کتاب‌ها و قصه‌های صوتی به ${dialect.title} در کتاپاد.`,
    path: routes.dialect(dialect.slug),
  });
}

export default async function DialectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dialect = getDialect(slug);
  if (!dialect) notFound();

  const books = booksByDialect(dialect.slug);
  const voices = VOICES.filter((v) => v.dialectSlug === dialect.slug);

  return (
    <>
      <PageView name="dialect" metadata={{ slug: dialect.slug }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "گویش‌ها", path: routes.dialects() },
          { name: dialect.title, path: routes.dialect(dialect.slug) },
        ]}
        eyebrow={dialect.region}
        title={`کتاب صوتی ${dialect.title}`}
        lead={dialect.description}
        aside={
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            <p className="tnum text-[15px] text-muted">{dialect.speakerEstimate}</p>
            <p className="tnum text-[15px] text-muted">{books.length} اثر در کاتالوگ</p>
          </div>
        }
      />

      <main>
        {voices.length > 0 && (
          <section className="section-rhythm pt-12">
            <div className="container-k">
              <h2 className="text-[24px] font-bold text-ink sm:text-[28px]">
                گویندگان {dialect.title}
              </h2>
              <p className="mt-2 max-w-[58ch] text-[16px] text-muted">
                اجرای این گویندگان مرجع تلفظ این گویش در واژه‌نامه کتاپاد است — هر اثر تازه،
                کیفیت اثر بعدی را بالا می‌برد.
              </p>

              <Reveal amount={0.05} className="mt-6">
                <ul className="flex flex-wrap gap-3">
                  {voices.map((voice) => (
                    <li key={voice.id}>
                      <Link
                        href={routes.voice(voice.slug)}
                        className="lift card group flex items-center gap-3 p-4"
                      >
                        <span className="chip chip-sm chip-paper chip-tilt" aria-hidden>
                          <Mic className="size-[18px]" strokeWidth={1.6} />
                        </span>
                        <span className="flex flex-col">
                          <span className="text-[16px] font-bold text-ink transition-colors duration-200 group-hover:text-violet">
                            {voice.name}
                          </span>
                          <span className="text-[14px] text-muted">{voice.timbre}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </section>
        )}

        <section className="section-rhythm">
          <div className="container-k">
            <h2 className="text-[24px] font-bold text-ink sm:text-[28px]">
              آثار به {dialect.title}
            </h2>
            <Reveal amount={0.05} className="mt-7">
              {books.length > 0 ? (
                <BookGrid books={books} />
              ) : (
                <div className="card p-10 text-center">
                  <p className="text-[19px] font-bold text-ink">این کاتالوگ در حال ساخت است</p>
                  <p className="mx-auto mt-2 max-w-[46ch] text-[16px] text-muted">
                    اگر به {dialect.title} روایت می‌کنید یا متنی برای ضبط دارید، از{" "}
                    <Link href="/#lead-form" className="font-medium text-violet hover:underline">
                      همین‌جا
                    </Link>{" "}
                    با ما در تماس باشید.
                  </p>
                </div>
              )}
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}
