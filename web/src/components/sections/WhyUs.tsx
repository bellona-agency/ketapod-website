import Image from "next/image";
import { Aura } from "@/components/primitives/Aura";
import { IconChip } from "@/components/primitives/IconChip";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Section } from "@/components/primitives/Section";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { ASSETS } from "@/lib/assets";
import { WHY_US } from "@/lib/content";
import { pad2 } from "@/lib/utils";

/** The 3D tile for a card, or undefined if that render hasn't landed yet. */
const tile = (id: string): string | undefined => ASSETS[`whyUs.${id}` as keyof typeof ASSETS];

/** Section 4 — Why Us. Four fixed cards, no API, no client JavaScript. */
export function WhyUs() {
  return (
    <Section id="why-us" className="overflow-hidden">
      <Aura mark="orbit" className="-top-24 left-[-12%] hidden md:block" size="size-[460px]" />

      <SectionHeading
        split
        index="01"
        eyebrow="Why Ketapod"
        title="چرا کتاپاد؟"
        lead="چهار تصمیم طراحی که تجربه شنیدن را از یک فایل صوتی ساده جدا می‌کند."
      />

      <RevealGroup
        className="mt-9 grid sm:mt-14 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        stagger={0.08}
        amount={0.15}
      >
        {WHY_US.map((item, i) => (
          <RevealItem key={item.id}>
            <article className="group lift relative h-full cursor-default overflow-hidden rounded-lg border border-line bg-card p-5 shadow-e1 sm:p-6 transition-[border-color,box-shadow,transform] duration-300 hover:border-violet-200 hover:shadow-e3">
              {/* corner arc reveals on hover — a drawn detail, not a glow */}
              <svg
                aria-hidden
                className="pointer-events-none absolute -left-6 -top-6 size-24 text-violet/0 transition-colors duration-400 group-hover:text-violet/15"
                viewBox="0 0 100 100"
                fill="none"
              >
                <circle cx="20" cy="20" r="46" stroke="currentColor" strokeWidth="10" />
              </svg>

              <div className="flex items-start justify-between">
                {tile(item.id) ? (
                  <span className="chip-tilt grid size-16 place-items-center transition-transform duration-300">
                    <Image
                      src={tile(item.id) as string}
                      alt=""
                      width={64}
                      height={64}
                      className="size-16 object-contain"
                    />
                  </span>
                ) : (
                  /* Falls back to the shared chip if a render is missing. */
                  <IconChip name={item.icon} tilt />
                )}
                <span className="tnum text-[13px] text-faint">{pad2(i + 1)}</span>
              </div>

              <h3 className="mt-5 text-[20px] font-bold text-ink">{item.title}</h3>
              <p className="mt-2.5 text-[16px] leading-[1.72] sm:leading-[1.95] text-muted">{item.description}</p>
            </article>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
