"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { AssetSlot, Float } from "@/components/primitives/AssetSlot";
import { Aura } from "@/components/primitives/Aura";
import { Cta } from "@/components/primitives/Cta";
import { Section } from "@/components/primitives/Section";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { asset } from "@/lib/assets";
import { trackEvent } from "@/lib/api";
import { FAQ_ITEMS, PRIMARY_CTA_LABEL } from "@/lib/content";
import { cn, pad2 } from "@/lib/utils";

const HALF = Math.ceil(FAQ_ITEMS.length / 2);
const COLUMNS = [FAQ_ITEMS.slice(0, HALF), FAQ_ITEMS.slice(HALF)];

/** Section 11 — FAQ. Static content, two independent accordion columns. */
export function Faq() {
  const [open, setOpen] = useState<string | null>(FAQ_ITEMS[0].id);

  function toggle(id: string, question: string) {
    setOpen((prev) => {
      const next = prev === id ? null : id;
      if (next) trackEvent("faq_item_opened", "faq", "faq_item", { id, question });
      return next;
    });
  }

  return (
    <Section id="faq" className="overflow-hidden">
      <Aura mark="dots" className="left-[-10%] top-32 hidden lg:block" size="size-[340px]" />
      {/* Decorative, outside the reading column, desktop only. */}
      <Float
        className="pointer-events-none absolute right-1 top-56 hidden w-[92px] xl:block 2xl:right-6 2xl:w-[104px]"
        amplitude={9}
        duration={6.5}
      >
        <AssetSlot src={asset("faqBubbleViolet")} alt="" label="حباب گفتگو" ratio="123 / 112" sizes="104px" />
      </Float>
      <Float
        className="pointer-events-none absolute bottom-24 left-1 hidden w-[96px] xl:block 2xl:left-6 2xl:w-[112px]"
        amplitude={8}
        duration={7.5}
        delay={0.7}
      >
        <AssetSlot
          src={asset("faqBubbleGreen")}
          alt=""
          label="حباب گفتگو"
          ratio="127 / 114"
          tone="mint"
          sizes="112px"
        />
      </Float>

      <SectionHeading
        split
        index="09"
        eyebrow="FAQ"
        title="سوالات متداول"
        lead="اگر جواب سوالت اینجا نبود، فرم پایین را پر کن تا برایت توضیح بدهیم."
        action={
          <Cta
            label={PRIMARY_CTA_LABEL}
            target="lead-form"
            event="final_cta_clicked"
            section="faq"
            element="faq_cta"
            variant="ghost"
          />
        }
      />

      <div className="mt-8 grid sm:mt-12 gap-x-10 gap-y-0 md:grid-cols-2">
        {COLUMNS.map((column, ci) => (
          <div key={ci} className="border-t border-line">
            {column.map((item, i) => (
              <FaqRow
                key={item.id}
                index={ci * HALF + i + 1}
                question={item.question}
                answer={item.answer}
                open={open === item.id}
                onToggle={() => toggle(item.id, item.question)}
              />
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

function FaqRow({
  index,
  question,
  answer,
  open,
  onToggle,
}: {
  index: number;
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();

  return (
    <div className="border-b border-line">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="group flex w-full cursor-pointer items-center gap-4 py-5 text-right"
        >
          <span
            className={cn(
              "tnum shrink-0 text-[13px] transition-colors duration-200",
              open ? "text-violet" : "text-faint",
            )}
          >
            {pad2(index)}
          </span>

          <span
            className={cn(
              "flex-1 text-[18px] font-semibold leading-[1.7] transition-colors duration-200",
              open ? "text-violet" : "text-ink group-hover:text-violet",
            )}
          >
            {question}
          </span>

          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full border transition-[transform,color,background-color,border-color] duration-300",
              open
                ? "rotate-[135deg] border-violet bg-violet text-white"
                : "border-line-2 text-ink group-hover:border-violet group-hover:text-violet",
            )}
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden />
          </span>
        </button>
      </h3>

      {/*
        `grid-template-rows: 0fr → 1fr` animates to the panel's intrinsic
        height in pure CSS. The old version measured it with AnimatePresence,
        which meant this section could never stop being an animation-library
        client component.
      */}
      <div
        id={panelId}
        role="region"
        aria-hidden={!open}
        className="grid transition-[grid-template-rows,opacity] duration-[380ms] ease-[var(--ease-out-expo)]"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <p className="ms-10 me-2 border-s-2 border-violet-200 pb-6 ps-4 text-[16px] leading-[1.78] sm:leading-[2.05] text-muted">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
