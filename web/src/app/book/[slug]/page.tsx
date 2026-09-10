import { Building2, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { FavouriteButton } from "@/components/account/FavouriteButton";
import { EditionPicker, type EditionView } from "@/components/catalog/EditionPicker";
import { CoverArt } from "@/components/primitives/CoverArt";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import {
  BOOKS,
  aggregateRating,
  booksByAuthor,
  booksByCategory,
  coverIndex,
  defaultEdition,
  formatDate,
  formatDuration,
  getAuthor,
  getBook,
  getCategory,
  getDialect,
  getPublisher,
  getVoice,
  isoDuration,
  type Book,
} from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";
import { JsonLd, breadcrumbLd, pageMetadata } from "@/lib/seo";
import { formatTime } from "@/lib/utils";

/* Every book is a static page. The spec's whole argument for a web surface is
   that these are the pages search engines land on, and an ISR miss on a cold
   page is the one moment that matters. */
export function generateStaticParams() {
  return BOOKS.map((book) => ({ slug: book.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const book = getBook(slug);
  if (!book) return {};

  const author = getAuthor(book.authorSlug);
  const edition = defaultEdition(book);

  return pageMetadata({
    title: `کتاب صوتی ${book.title}${author ? ` — ${author.name}` : ""}`,
    /* Built from the book's own first sentences rather than a template, so no
       two book pages ship the same description. */
    description: `${book.description.slice(0, 150)}… ${formatDuration(edition.durationSec)}، ${book.editions.length} نسخه صوتی.`,
    path: routes.book(book.slug),
    type: "article",
  });
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = getBook(slug);
  if (!book) notFound();

  const author = getAuthor(book.authorSlug);
  const publisher = getPublisher(book.publisherSlug);
  const categories = book.categorySlugs
    .map(getCategory)
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const rating = aggregateRating(book);
  const primary = defaultEdition(book);

  /*
   * Editions are resolved here, on the server, and handed down flat. The client
   * picker never sees a `voiceId` and therefore can never render a narrator
   * that has no matching source — the spec's id contract, enforced by making
   * the unsafe version unrepresentable rather than by remembering to check.
   *
   * Ordered so the default edition is first: the picker selects `editions[0]`,
   * and that is what server-renders into the HTML.
   */
  const editionViews: EditionView[] = [primary, ...book.editions.filter((e) => e !== primary)]
    /* Annotated rather than `satisfies`: inference from an object literal makes
       `dialectTitle` a required property that may be undefined, which is not
       the same type as the optional one `EditionView` declares. */
    .map((edition): EditionView | null => {
      const voice = getVoice(edition.voiceId);
      if (!voice) return null;
      const dialect = edition.dialectSlug ? getDialect(edition.dialectSlug) : undefined;
      return {
        id: edition.id,
        voiceName: voice.name,
        voiceSlug: voice.slug,
        voiceTimbre: voice.timbre,
        narratorType: edition.narratorType,
        dialectTitle: dialect?.title,
        priceRial: edition.priceRial,
        durationSec: edition.durationSec,
        isKidsFriendly: edition.isKidsFriendly,
        chapters: edition.chapters,
      };
    })
    .filter((e): e is EditionView => e !== null);

  /* More by the author first, then the same shelf — a reader who finished this
     page is more likely to want another book by the same writer than another
     book about the same subject. */
  const related: Book[] = [
    ...booksByAuthor(book.authorSlug).filter((b) => b.slug !== book.slug),
    ...book.categorySlugs
      .flatMap(booksByCategory)
      .filter((b) => b.slug !== book.slug && b.authorSlug !== book.authorSlug),
  ]
    .filter((b, i, arr) => arr.findIndex((x) => x.slug === b.slug) === i)
    .slice(0, 4);

  const trail = [
    { name: "کتاپاد", path: routes.home() },
    { name: "کتاب‌ها", path: routes.books() },
    ...(categories[0]
      ? [{ name: categories[0].title, path: routes.category(categories[0].slug) }]
      : []),
    { name: book.title, path: routes.book(book.slug) },
  ];

  return (
    <>
      <PageView name="book" metadata={{ slug: book.slug }} />

      <main className="pt-24 sm:pt-32 md:pt-40">
        <div className="container-k">
          <Breadcrumbs trail={trail} />

          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
            {/* ── Work ─────────────────────────────────────────────── */}
            <div className="flex flex-col gap-10">
              <Reveal amount={0.05} className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  {categories.map((c) => (
                    <Link
                      key={c.slug}
                      href={routes.category(c.slug)}
                      className="rounded-full bg-violet-50 px-3 py-1 text-[14px] font-medium text-violet-700 transition-colors duration-200 hover:bg-violet-100"
                    >
                      {c.title}
                    </Link>
                  ))}
                </div>

                <div className="flex items-start gap-4">
                  <h1 className="flex-1 text-[32px] font-extrabold leading-[1.28] tracking-[-0.015em] text-ink sm:text-[42px] md:text-[50px]">
                    {book.title}
                  </h1>
                  {/* The one interactive island on an otherwise static page. It
                      resolves its own state after hydration, so this page stays
                      statically generated and indexable. */}
                  <FavouriteButton bookSlug={book.slug} className="mt-2 shrink-0" />
                </div>

                {book.originalTitle && (
                  <p className="text-[17px] text-faint" dir="ltr">
                    {book.originalTitle}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[17px]">
                  {author && (
                    <Link
                      href={routes.author(author.slug)}
                      className="font-bold text-ink transition-colors duration-200 hover:text-violet"
                    >
                      {author.name}
                    </Link>
                  )}
                  {book.translator && (
                    <span className="text-muted">ترجمه {book.translator}</span>
                  )}
                  {publisher && (
                    <Link
                      href={routes.publisher(publisher.slug)}
                      className="flex items-center gap-1.5 text-muted transition-colors duration-200 hover:text-violet"
                    >
                      <Building2 className="size-4" strokeWidth={1.7} aria-hidden />
                      {publisher.name}
                    </Link>
                  )}
                  {rating && (
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <Star className="size-4 fill-amber text-amber" strokeWidth={1.7} aria-hidden />
                      <span className="tnum font-bold">{rating.value.toFixed(1)}</span>
                      <span className="text-faint">({rating.count} نظر)</span>
                    </span>
                  )}
                </div>

                <p className="max-w-[62ch] text-[18px] leading-[1.9] text-ink-2">
                  {book.description}
                </p>
              </Reveal>

              {/*
                The assistant-generated summary, published on the public page.
                The spec asks for this explicitly and the reason is not
                generosity: it is free indexable text about the book that no
                competitor's catalogue page has.
              */}
              <Reveal amount={0.05} className="panel bg-paper-2 ring-1 ring-inset ring-line">
                <h2 className="text-[22px] font-bold text-ink">خلاصه کتاب</h2>
                <p className="mt-4 max-w-[62ch] text-[17px] leading-[1.9] text-ink-2">
                  {book.summary}
                </p>
                <p className="mt-5 text-[14px] text-faint">
                  این خلاصه توسط کتاب‌یار از متن کتاب تولید شده است.
                </p>
              </Reveal>

              {/*
                A real excerpt of the book's own words, with timings.
                One data structure, four jobs — this page uses the indexable
                one. The same cues drive text/audio sync in the player and feed
                the assistant's context.
              */}
              {primary.transcriptSample.length > 0 && (
                <Reveal amount={0.05} className="flex flex-col gap-4">
                  <div>
                    <h2 className="text-[22px] font-bold text-ink">از متن کتاب</h2>
                    <p className="mt-1.5 text-[15px] text-muted">
                      ترنسکریپت همگام با زمان — آغاز فصل «{primary.chapters[0]?.title}»
                    </p>
                  </div>

                  <ol className="flex flex-col gap-0 overflow-hidden rounded-lg border border-line bg-card">
                    {primary.transcriptSample.map((cue) => (
                      <li
                        key={cue.startSec}
                        className="flex gap-4 border-b border-line px-5 py-4 last:border-b-0"
                      >
                        <span className="tnum shrink-0 pt-1 text-[13px] text-faint" dir="ltr">
                          {formatTime(cue.startSec)}
                        </span>
                        <p className="text-[17px] leading-[1.9] text-ink-2">{cue.text}</p>
                      </li>
                    ))}
                  </ol>
                </Reveal>
              )}

              {/* ── Reviews ───────────────────────────────────────── */}
              {book.reviews.length > 0 && (
                <Reveal amount={0.05} className="flex flex-col gap-4">
                  <h2 className="text-[22px] font-bold text-ink">نظر شنوندگان</h2>
                  <ul className="flex flex-col gap-4">
                    {book.reviews.map((review) => (
                      <li key={review.id} className="card p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[16px] font-bold text-ink">{review.author}</span>
                          <span className="flex items-center gap-1" aria-label={`${review.rating} از ۵`}>
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                className={
                                  i < review.rating
                                    ? "size-4 fill-amber text-amber"
                                    : "size-4 text-line-2"
                                }
                                strokeWidth={1.7}
                                aria-hidden
                              />
                            ))}
                          </span>
                        </div>
                        <p className="mt-3 text-[16px] leading-[1.85] text-ink-2">{review.body}</p>
                        <p className="mt-3 text-[14px] text-faint">{formatDate(review.date)}</p>
                      </li>
                    ))}
                  </ul>
                </Reveal>
              )}
            </div>

            {/* ── Performance ──────────────────────────────────────── */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <Reveal amount={0.05} className="flex flex-col gap-8">
                <CoverArt
                  src={book.coverUrl}
                  alt={`کاور کتاب صوتی ${book.title}`}
                  index={coverIndex(book.slug)}
                  rounded="rounded-lg"
                  className="aspect-square w-full shadow-e3"
                  sizes="(max-width: 1024px) 100vw, 380px"
                />
                <EditionPicker editions={editionViews} bookTitle={book.title} />
              </Reveal>
            </aside>
          </div>

          {related.length > 0 && (
            <section className="section-rhythm pt-20">
              <h2 className="text-[27px] font-bold text-ink sm:text-[34px]">کتاب‌های مرتبط</h2>
              <Reveal amount={0.05} className="mt-7">
                <BookGrid books={related} />
              </Reveal>
            </section>
          )}
        </div>
      </main>

      <JsonLd data={breadcrumbLd(trail)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Audiobook",
          name: book.title,
          url: absolute(routes.book(book.slug)),
          description: book.description,
          inLanguage: book.language,
          datePublished: String(book.publishedYear),
          ...(book.isbn ? { isbn: book.isbn } : {}),
          ...(author
            ? { author: { "@type": "Person", name: author.name, url: absolute(routes.author(author.slug)) } }
            : {}),
          ...(publisher ? { publisher: { "@type": "Organization", name: publisher.name } } : {}),
          /* `readBy` and `duration` describe the default edition. Search
             engines model one audiobook per URL, so claiming three narrators
             on one record would be a worse answer than claiming the one a
             visitor actually lands on. */
          duration: isoDuration(primary.durationSec),
          ...(getVoice(primary.voiceId)
            ? { readBy: { "@type": "Person", name: getVoice(primary.voiceId)!.name } }
            : {}),
          /* Priced in Rial because that is what `IRR` means. The page shows
             Toman, which is the same money divided by ten and is not a
             currency code — quoting the Toman figure against `IRR` would
             advertise every edition at a tenth of its price. */
          offers: book.editions.map((edition) => ({
            "@type": "Offer",
            price: edition.priceRial,
            priceCurrency: "IRR",
            availability: "https://schema.org/InStock",
            url: absolute(routes.book(book.slug)),
          })),
          ...(rating
            ? {
                aggregateRating: {
                  "@type": "AggregateRating",
                  ratingValue: rating.value.toFixed(1),
                  reviewCount: rating.count,
                  bestRating: 5,
                  worstRating: 1,
                },
              }
            : {}),
          review: book.reviews.map((review) => ({
            "@type": "Review",
            author: { "@type": "Person", name: review.author },
            datePublished: review.date,
            reviewBody: review.body,
            reviewRating: {
              "@type": "Rating",
              ratingValue: review.rating,
              bestRating: 5,
              worstRating: 1,
            },
          })),
        }}
      />
    </>
  );
}
