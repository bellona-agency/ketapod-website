import { Mic, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookGrid } from "@/components/catalog/BookCard";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { Reveal } from "@/components/primitives/Reveal";
import { VOICES, booksByVoice, getDialect, getVoiceBySlug } from "@/lib/catalog";
import { absolute, routes } from "@/lib/routes";
import { JsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return VOICES.map((voice) => ({ slug: voice.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const voice = getVoiceBySlug(slug);
  if (!voice) return {};

  return pageMetadata({
    title:
      voice.type === "human"
        ? `کتاب صوتی با صدای ${voice.name}`
        : `کتاب صوتی با روایت ${voice.name}`,
    description: `${voice.bio.slice(0, 150)}… همه آثار روایت‌شده توسط ${voice.name} در کتاپاد.`,
    path: routes.voice(voice.slug),
  });
}

/**
 * A narrator's page.
 *
 * The spec gives this its own URL on the grounds that a well-known narrator's
 * name is a high-volume search query — someone looking for "کتاب صوتی با صدای
 * فلانی" is a real query with real intent, and it has no landing page anywhere
 * unless one is built for it.
 *
 * Only human narrators get `schema.org/Person`; a synthetic model is not a
 * person, and claiming one would be a false statement to a search engine about
 * who performed the work.
 */
export default async function VoicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const voice = getVoiceBySlug(slug);
  if (!voice) notFound();

  const books = booksByVoice(voice.id);
  const dialect = voice.dialectSlug ? getDialect(voice.dialectSlug) : undefined;

  return (
    <>
      <PageView name="voice" metadata={{ slug: voice.slug }} />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "گویندگان", path: routes.voices() },
          { name: voice.name, path: routes.voice(voice.slug) },
        ]}
        eyebrow={voice.type === "human" ? "گوینده" : "مدل صوتی"}
        title={voice.name}
        lead={voice.bio}
        aside={
          <div className="flex flex-col items-start gap-2 md:items-end">
            <span className="flex items-center gap-2 text-[16px] font-medium text-ink-2">
              {voice.type === "human" ? (
                <Mic className="size-4" strokeWidth={1.8} aria-hidden />
              ) : (
                <Sparkles className="size-4" strokeWidth={1.8} aria-hidden />
              )}
              {voice.timbre}
            </span>
            <p className="tnum text-[15px] text-muted">{books.length} اثر</p>
          </div>
        }
        below={
          (dialect || voice.kidsApproved) && (
            <div className="flex flex-wrap gap-2">
              {dialect && (
                <Link
                  href={routes.dialect(dialect.slug)}
                  className="rounded-full bg-violet-50 px-4 py-2 text-[15px] font-medium text-violet-700 transition-colors duration-200 hover:bg-violet-100"
                >
                  روایت به {dialect.title}
                </Link>
              )}
              {voice.kidsApproved && (
                <span className="rounded-full bg-mint-100 px-4 py-2 text-[15px] font-medium text-mint-ink">
                  تأییدشده برای کاتالوگ کودک
                </span>
              )}
            </div>
          )
        }
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <h2 className="text-[24px] font-bold text-ink sm:text-[28px]">
            {voice.type === "human" ? `آثار با صدای ${voice.name}` : `آثار با روایت ${voice.name}`}
          </h2>
          <Reveal amount={0.05} className="mt-7">
            <BookGrid books={books} />
          </Reveal>
        </div>
      </main>

      {voice.type === "human" && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Person",
            name: voice.name,
            description: voice.bio,
            url: absolute(routes.voice(voice.slug)),
            jobTitle: "گوینده کتاب صوتی",
          }}
        />
      )}
    </>
  );
}
