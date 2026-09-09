import { Mic, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/catalog/PageHeader";
import { PageView } from "@/components/primitives/PageView";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { VOICES, booksByVoice, getDialect } from "@/lib/catalog";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "گویندگان",
  description:
    "گویندگان انسانی و مدل‌های صوتی کتاپاد — روایت فارسی، گیلکی، ترکی آذربایجانی و لری، با صداهای تأییدشده برای کودک.",
  path: routes.voices(),
});

/**
 * The voice marketplace, from the outside.
 *
 * Human narrators and synthetic models sit in the same list rather than in two
 * sections, because from a listener's side of the product they are the same
 * choice: whose reading do you want. The badge says which is which; the page
 * does not rank one above the other.
 */
export default function VoicesPage() {
  const humans = VOICES.filter((v) => v.type === "human");
  const models = VOICES.filter((v) => v.type === "ai");

  return (
    <>
      <PageView name="voices" />

      <PageHeader
        trail={[
          { name: "کتاپاد", path: routes.home() },
          { name: "گویندگان", path: routes.voices() },
        ]}
        eyebrow="بازارگاه صدا"
        title="یک کتاب، چند روایت"
        lead="گوینده بخشی از کتاب است، نه تنظیمات آن. هر اثر می‌تواند با چند صدا اجرا شود — انسانی یا مدل صوتی، فارسی یا به گویش مادری — و شما پیش از شنیدن انتخاب می‌کنید."
        aside={
          <p className="tnum text-[15px] text-muted">
            {humans.length} گوینده انسانی · {models.length} مدل صوتی
          </p>
        }
      />

      <main className="section-rhythm pt-12">
        <div className="container-k">
          <RevealGroup
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            stagger={0.05}
            amount={0.05}
          >
            {VOICES.map((voice) => {
              const dialect = voice.dialectSlug ? getDialect(voice.dialectSlug) : undefined;
              const count = booksByVoice(voice.id).length;

              return (
                <RevealItem key={voice.id}>
                  <Link href={routes.voice(voice.slug)} className="lift card group flex h-full flex-col gap-3 p-6">
                    <span className="chip chip-paper chip-tilt" aria-hidden>
                      {voice.type === "human" ? (
                        <Mic className="size-5" strokeWidth={1.6} />
                      ) : (
                        <Sparkles className="size-5" strokeWidth={1.6} />
                      )}
                    </span>

                    <h2 className="text-[20px] font-bold text-ink transition-colors duration-200 group-hover:text-violet">
                      {voice.name}
                    </h2>
                    <p className="text-[16px] text-muted">{voice.timbre}</p>

                    <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                      <span className="rounded-full bg-paper-2 px-2.5 py-1 text-[13px] font-medium text-ink-2">
                        {voice.type === "human" ? "گوینده انسانی" : "مدل صوتی"}
                      </span>
                      {dialect && (
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[13px] font-medium text-violet-700">
                          {dialect.title}
                        </span>
                      )}
                      {voice.kidsApproved && (
                        <span className="rounded-full bg-mint-100 px-2.5 py-1 text-[13px] font-medium text-mint-ink">
                          تأییدشده کودک
                        </span>
                      )}
                      <span className="tnum rounded-full px-1 py-1 text-[13px] text-faint">
                        {count} اثر
                      </span>
                    </div>
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
