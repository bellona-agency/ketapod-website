import { IconChip } from "@/components/primitives/IconChip";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Section } from "@/components/primitives/Section";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { PROBLEMS } from "@/lib/content";
import { pad2 } from "@/lib/utils";

/**
 * Section 5 — Problem.
 *
 * The page's dark panel. Items sit on a hairline grid rather than in cards: six
 * boxes in a row would flatten the rhythm right after the four cards above, and
 * the ruled grid reads as an argument being laid out.
 */
export function Problem() {
  return (
    <Section id="problem" shell="night">
      <SectionHeading
        index="03"
        eyebrow="The Problem"
        title="مشکل کجاست؟"
        lead="شش شکافی که تجربه فعلی کتاب صوتی را برای شنونده امروزی ناکافی می‌کند."
        tone="night"
        align="center"
        className="mx-auto"
      />

      <RevealGroup
        className="mt-7 grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-night-line/70 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3"
        stagger={0.07}
        amount={0.12}
      >
        {PROBLEMS.map((p, i) => (
          <RevealItem
            key={p.id}
            className="group relative bg-night px-5 py-6 transition-colors duration-300 hover:bg-night-2 sm:px-6 sm:py-8 md:px-8 md:py-9"
          >
            <div className="flex items-center gap-3">
              <IconChip name={p.icon} tone="night" size="sm" tilt />
              <span className="tnum text-[13px] text-white/25">{pad2(i + 1)}</span>
            </div>

            <h3 className="mt-5 text-[19px] font-bold leading-[1.6] text-night-ink">{p.title}</h3>
            <p className="mt-2.5 text-[16px] leading-[1.75] sm:leading-[2] text-night-muted">{p.description}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
