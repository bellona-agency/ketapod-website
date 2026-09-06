import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { AUTHORS, booksByAuthor, getAuthor } from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";
import { JsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return AUTHORS.map((author) => ({ slug: author.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const author = getAuthor(slug);
  if (!author) return {};

  return pageMetadata({
    title: `کتاب‌های صوتی ${author.name}`,
    description: `${author.bio.slice(0, 150)}… همه آثار صوتی ${author.name} در کتاپاد.`,
    path: routes.author(author.slug),
  });
}

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const author = getAuthor(slug);
  if (!author) notFound();

  const books = booksByAuthor(author.slug);

  /* Persian solar years, dashed. A living author gets an open range rather than
     a bare birth year, which reads as a typo. */
  const lifespan = author.birthYear
    ? `${author.birthYear} – ${author.deathYear ?? "اکنون"}`
    : undefined;

  return (
    <>
      <PageView name="author" metadata={{ slug: author.slug }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌ها", path: routes.books() },
          { name: author.name, path: routes.author(author.slug) },
        ]}
        eyebrow="نویسنده"
        title={author.name}
        lead={author.bio}
        aside={
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            {lifespan && <p className="tnum text-[15px] text-muted">{lifespan}</p>}
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
          "@type": "Person",
          name: author.name,
          ...(author.nameLatin ? { alternateName: author.nameLatin } : {}),
          description: author.bio,
          url: absolute(routes.author(author.slug)),
          jobTitle: "نویسنده",
        }}
      />
    </>
  );
}
