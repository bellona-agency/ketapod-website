import { Play } from "lucide-react";
import { AssetSlot, Float } from "@/components/primitives/AssetSlot";
import { Cta } from "@/components/primitives/Cta";
import { Reveal } from "@/components/primitives/Reveal";
import { Section } from "@/components/primitives/Section";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { Waveform } from "@/components/primitives/Waveform";
import { asset } from "@/lib/assets";
import { FINAL_CTA } from "@/lib/content";

/**
 * Section 13 — Final CTA.
 *
 * It now goes through `SectionHeading` like every other section. It used to
 * hand-roll its eyebrow and set its `h2` at 32/40/46 against the page's
 * 32/34/42 — close enough to look like a mistake, far enough to break the
 * rhythm at the one place the page is asking for the click.
 */
export function FinalCta() {
  return (
    <Section
      id="final-cta"
      shell="deep"
      decor={
        <Waveform
          bars={40}
          active
          seed={57}
          minScale={0.08}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 text-white/[0.09]"
          barClassName="w-[4px]"
        />
      }
    >
      <div className="grid items-center gap-10 md:grid-cols-[1.25fr_0.75fr]">
        <div>
          <SectionHeading
            index="11"
            eyebrow="Start Listening"
            title={FINAL_CTA.title}
            lead={FINAL_CTA.subtitle}
            tone="night"
          />

          <Reveal delay={0.2} className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Cta
              label={FINAL_CTA.primaryCta.label}
              target={FINAL_CTA.primaryCta.target}
              event="final_cta_clicked"
              section="final-cta"
              element="primary_cta"
              variant="violet"
              className="h-[60px] min-h-[60px] w-full bg-white px-8 text-[19px] text-violet-700 shadow-e3 hover:bg-violet-100 sm:w-auto"
            />
            <Cta
              label={FINAL_CTA.secondaryCta.label}
              target={FINAL_CTA.secondaryCta.target}
              event="hero_secondary_cta_clicked"
              section="final-cta"
              element="secondary_cta"
              variant="onnight"
              arrow={false}
              icon={<Play className="size-4 fill-current" strokeWidth={0} aria-hidden />}
              className="h-[60px] min-h-[60px] w-full px-7 text-[19px] sm:w-auto"
            />
          </Reveal>
        </div>

        <Reveal delay={0.15} className="relative mx-auto w-full max-w-[260px]">
          <Float amplitude={12} duration={6.5} rotate={2}>
            <AssetSlot
              src={asset("finalCtaHeadphones")}
              alt="هدفون سه‌بعدی با دکمه پخش"
              label="هدفون سه‌بعدی — المان پایانی صفحه"
              ratio="384 / 212"
              tone="night"
              rounded="rounded-2xl"
              sizes="260px"
            />
          </Float>
        </Reveal>
      </div>
    </Section>
  );
}
