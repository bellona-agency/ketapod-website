import { Aura } from "@/components/primitives/Aura";
import { IconChip } from "@/components/primitives/IconChip";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Section } from "@/components/primitives/Section";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { Waveform } from "@/components/primitives/Waveform";
import { FeatureCtaTile } from "./FeatureCtaTile";
import { FEATURES } from "@/lib/content";

const [lead, ...rest] = FEATURES;

/**
 * Section 6 — Features.
 *
 * Bento rather than an eight-up grid: the AI recommendation feature is the
 * product's actual argument, so it gets a 2×2 tile and the violet fill, and the
 * remaining seven read as supporting detail. The twelfth cell is the CTA, which
 * is why the grid resolves cleanly instead of leaving a hole.
 */
export function Features() {
  return (
    <Section id="features" className="overflow-hidden">
      <Aura mark="arc" className="right-[-10%] top-16 hidden md:block" size="size-[380px]" />

      <SectionHeading
        split
        index="04"
        eyebrow="Features"
        title="چه چیزی داخل کتاپاد است؟"
        lead="از انتخاب گوینده تا کتابخانه شخصی — امکاناتی که تجربه شنیدن را شخصی و پیوسته نگه می‌دارند."
      />

      <RevealGroup
        /* The row floor pads short tiles out to a shared height so the bento
           lines up. Stacked one per row on a phone there is nothing to line
           them up with, so it only adds empty space — eight times over. */
        className="mt-9 grid grid-cols-1 gap-3.5 sm:mt-14 sm:auto-rows-[minmax(168px,auto)] sm:grid-cols-2 lg:grid-cols-4"
        stagger={0.06}
        amount={0.1}
      >
        {/* ── Lead tile ─────────────────────────────────────── */}
        <RevealItem className="sm:col-span-2 lg:row-span-2">
          <article className="group lift relative flex h-full flex-col justify-between overflow-hidden rounded-lg bg-violet p-6 text-white shadow-violet sm:p-7 md:p-8">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_15%_0%,rgba(255,255,255,0.22)_0%,transparent_55%)]"
            />
            <div aria-hidden className="dotgrid pointer-events-none absolute inset-0 text-white/10" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <IconChip name={lead.icon} tone="violet" tilt className="backdrop-blur-sm" />
                {"badge" in lead && lead.badge && (
                  <span className="tnum rounded-full bg-white px-3 py-1 text-[13px] font-bold tracking-[0.08em] text-violet-700">
                    {lead.badge}
                  </span>
                )}
              </div>

              <h3 className="mt-6 text-[25px] font-bold leading-[1.5] md:text-[30px]">
                {lead.title}
              </h3>
              <p className="mt-3 max-w-[34ch] text-[17px] leading-[1.75] sm:leading-[2] text-white/80">
                {lead.description}
              </p>
            </div>

            <div className="relative mt-8">
              <Waveform bars={28} active seed={23} className="h-12 text-white/45" barClassName="w-[3px]" />
            </div>
          </article>
        </RevealItem>

        {/* ── Supporting tiles ──────────────────────────────── */}
        {rest.map((f) => (
          <RevealItem key={f.id}>
            <article className="group lift relative flex h-full cursor-default flex-col rounded-lg border border-line bg-card p-5 shadow-e1 sm:p-6 transition-[border-color,box-shadow,transform] duration-300 hover:border-violet-200 hover:shadow-e3">
              <IconChip name={f.icon} tilt />
              <h3 className="mt-4 text-[18px] font-bold text-ink">{f.title}</h3>
              <p className="mt-2 text-[16px] leading-[1.72] sm:leading-[1.95] text-muted">{f.description}</p>
            </article>
          </RevealItem>
        ))}

        {/* ── Closing CTA tile ──────────────────────────────── */}
        <RevealItem>
          <FeatureCtaTile />
        </RevealItem>
      </RevealGroup>
    </Section>
  );
}
