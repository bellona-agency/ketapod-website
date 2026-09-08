import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/catalog/PageHeader";
import { CoverArt } from "@/components/primitives/CoverArt";
import { PageView } from "@/components/primitives/PageView";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import {
  COLLECTIONS,
  booksInCollection,
  coverIndex,
  defaultEdition,
  formatDuration,
  getAuthor,
  getCollection,
} from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";
import { JsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return COLLECTIONS.map((collection) => ({ slug: collection.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const collection = getCollection(slug);
  if (!collection) return {};

  return pageMetadata({
    title: collection.title,
    description: collection.description,
    path: routes.collection(collection.slug),
  });
}

/**
 * A collection is an ordered reading path, so this is a numbered list rather
 * than the usual grid — a grid says "here are some books", a list says "start
 * here, then this". That is the whole difference between a collection and a
 * category, and it should be visible without reading the copy.
 */
export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = getCollection(slug);
  if (!collection) notFound();

  const books = booksInCollection(collection.slug);
  const totalSec = books.reduce((sum, b) => sum + defaultEdition(b).durationSec, 0);

  return (
    <>
      <PageView name="collection" metadata={{ slug: collection.slug }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "کتاب‌ها", path: routes.books() },
          { name: collection.title, path: routes.collection(collection.slug) },
        ]}
        eyebrow="مجموعه"
        title={collection.title}
        lead={collection.description}
        aside={
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            <p className="tnum text-[15px] text-muted">{books.length} عنوان</p>
            <p className="tnum text-[15px] text-muted">{formatDuration(totalSec)} شنیدن</p>
          </div>
        }
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <RevealGroup as="ol" className="flex flex-col gap-4" stagger={0.06} amount={0.05}>
            {books.map((book, i) => {
              const author = getAuthor(book.authorSlug);
              const edition = defaultEdition(book);
              return (
                <RevealItem as="li" key={book.slug}>
                  <Link
                    href={routes.book(book.slug)}
                    className="lift card group flex items-center gap-5 p-4 sm:gap-6 sm:p-5"
                  >
                    <span className="tnum w-8 shrink-0 text-center text-[22px] font-extrabold text-line-2 transition-colors duration-200 group-hover:text-violet sm:text-[28px]">
                      {i + 1}
                    </span>

                    <CoverArt
                      src={book.coverUrl}
                      alt={`کاور ${book.title}`}
                      index={coverIndex(book.slug)}
                      rounded="rounded-sm"
                      className="aspect-square w-20 shrink-0 shadow-e1 sm:w-24"
                      sizes="96px"
                    />

                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[18px] font-bold text-ink transition-colors duration-200 group-hover:text-violet sm:text-[20px]">
                        {book.title}
                      </span>
                      {author && <span className="text-[15px] text-muted">{author.name}</span>}
                      <span className="tnum mt-1 text-[14px] text-faint">
                        {formatDuration(edition.durationSec)} · {book.editions.length} نسخه صوتی
                      </span>
                    </span>
                  </Link>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </div>
      </main>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: collection.title,
          description: collection.description,
          url: absolute(routes.collection(collection.slug)),
          numberOfItems: books.length,
          itemListElement: books.map((book, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: book.title,
            url: absolute(routes.book(book.slug)),
          })),
        }}
      />
    </>
  );
}
