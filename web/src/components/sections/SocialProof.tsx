import { Quote } from "lucide-react";
import Image from "next/image";
import { RailNudge } from "@/components/primitives/RailNudge";
import { Reveal, RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Aura } from "@/components/primitives/Aura";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { type SocialProofData } from "@/lib/api";
import { cn, faFigure } from "@/lib/utils";

const AVATAR_TINTS = [
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-ink",
  "bg-mint-100 text-mint-ink",
  "bg-rose-100 text-rose-ink",
];

/**
 * Section 10 — Social Proof.
 *
 * Testimonials sit on a drag/scroll rail with alternating vertical offsets
 * rather than in a tidy grid: four equal boxes read as filler, a rail reads as
 * a stack of real quotes you can push through.
 *
 * Stats and testimonials arrive as a prop from the server — see `Localization`
 * and `page.tsx` for why none of these sections fetch on mount any more.
 */
export function SocialProof({ data }: { data: SocialProofData }) {
  return (
    <section id="social-proof" className="section-rhythm relative overflow-hidden">
      <Aura mark="arc" className="right-[-12%] top-24 hidden md:block" size="size-[400px]" />
      <div className="container-k">
        <SectionHeading
          split
          index="08"
          eyebrow="Social Proof"
          title="آنچه کاربران می‌گویند"
          lead="بازخوردهای واقعی از کسانی که تجربه شنیدن‌شان با کتاپاد تغییر کرده است."
          action={<RailNudge prevLabel="نظر قبلی" nextLabel="نظر بعدی" />}
        />

        {/* ── Stats line ───────────────────────────────────────── */}
        <RevealGroup
          className="mt-8 grid sm:mt-12 grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-6 sm:flex sm:flex-wrap sm:items-center sm:gap-x-10"
          stagger={0.06}
          amount={0.4}
        >
          {data.stats.map((s) => (
            <RevealItem key={s.label} className="flex items-baseline gap-2.5">
              <span className="tnum text-[30px] font-bold text-ink">
                {faFigure(s.value)}
              </span>
              <span className="text-[16px] text-muted">{s.label}</span>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>

      {/* ── Testimonial rail (full-bleed) ──────────────────────── */}
      <Reveal delay={0.05} className="mt-10">
        <div
          data-rail
          className="rail-bleed no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto pb-10 pt-6"
        >
          {data.testimonials.map((t, i) => (
            /*
             * The stagger is a margin on this wrapper, and the hover is a
             * transform on the card inside it. They used to be on the same
             * element, where they fought: the card's resting offset was a
             * 26px margin but the hover animated `y` to 21, so every other
             * card jumped *down* 21px on hover instead of lifting 5.
             */
            <div
              key={t.id}
              className="shrink-0 snap-start"
              style={{ marginTop: i % 2 === 1 ? 26 : 0 }}
            >
              <Reveal
                as="figure"
                delay={0.05 * i}
                amount={0.3}
                className="lift w-[300px] rounded-lg border border-line bg-card p-5 shadow-e2 sm:p-6 sm:w-[340px]"
              >
                <Quote
                  className="size-7 rotate-180 text-violet/25"
                  strokeWidth={1.6}
                  aria-hidden
                />
                <blockquote className="mt-4 text-[17px] leading-[1.75] sm:leading-[2] text-ink-2">
                  {t.message}
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-line pt-5">
                  {t.avatarUrl ? (
                    <span className="relative size-11 shrink-0 overflow-hidden rounded-full">
                      <Image
                        src={t.avatarUrl}
                        alt={t.name}
                        fill
                        sizes="44px"
                        className="object-cover"
                      />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-full text-[18px] font-bold",
                        AVATAR_TINTS[i % AVATAR_TINTS.length],
                      )}
                      aria-hidden
                    >
                      {t.name.slice(0, 1)}
                    </span>
                  )}
                  <span>
                    <span className="block text-[17px] font-bold text-ink">{t.name}</span>
                    <span className="block text-[15px] text-muted">{t.role}</span>
                  </span>
                </figcaption>
              </Reveal>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
