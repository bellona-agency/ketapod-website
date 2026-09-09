import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { PUBLISHERS, booksByPublisher, getPublisher } from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";
import { JsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return PUBLISHERS.map((publisher) => ({ slug: publisher.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const publisher = getPublisher(slug);
  if (!publisher) return {};

  return pageMetadata({
    title: `کتاب‌های صوتی ${publisher.name}`,
    description: `${publisher.bio} آثار صوتی منتشرشده از ${publisher.name} در کتاپاد.`,
    path: routes.publisher(publisher.slug),
  });
}

export default async function PublisherPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publisher = getPublisher(slug);
  if (!publisher) notFound();

  const books = booksByPublisher(publisher.slug);

  return (
    <>
      <PageView name="publisher" metadata={{ slug: publisher.slug }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌ها", path: routes.books() },
          { name: publisher.name, path: routes.publisher(publisher.slug) },
        ]}
        eyebrow="ناشر"
        title={publisher.name}
        lead={publisher.bio}
        aside={
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            {publisher.foundedYear && (
              <p className="tnum text-[15px] text-muted">تأسیس {publisher.foundedYear}</p>
            )}
            <p className="tnum text-[15px] text-muted">{books.length} عنوان صوتی</p>
          </div>
        }
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <Reveal amount={0.05}>
            <BookGrid books={books} />
          </Reveal>
        </div>
      </main>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: publisher.name,
          description: publisher.bio,
          url: absolute(routes.publisher(publisher.slug)),
          ...(publisher.foundedYear ? { foundingDate: String(publisher.foundedYear) } : {}),
        }}
      />
    </>
  );
}
