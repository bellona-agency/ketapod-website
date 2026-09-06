"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AssetSlot, Float } from "@/components/primitives/AssetSlot";
import { asset } from "@/lib/assets";
import { CoverArt } from "@/components/primitives/CoverArt";
import { Marquee } from "@/components/primitives/Marquee";
import { Reveal, RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { Aura } from "@/components/primitives/Aura";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import {
  FALLBACK_LOCALIZATION,
  getLocalization,
  type LocalizationData,
} from "@/lib/api";
import { springSoft } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Section 9 — Language & Cultural Diversity.
 *
 * Structure is fixed in the front-end; title, subtitle, languages, topics and
 * samples all come from `/home/localization`. Picking a language filters the
 * samples in place — the point of the section is easier to feel than to read.
 */
export function Localization() {
  const prefersReduced = useReducedMotion();
  const [data, setData] = useState<LocalizationData>(FALLBACK_LOCALIZATION);
  const [lang, setLang] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getLocalization(ac.signal).then((d) => {
      if (!ac.signal.aborted && d) setData(d);
    });
    return () => ac.abort();
  }, []);

  const samples = lang ? data.samples.filter((s) => s.language === lang) : data.samples;
  const visible = samples.length ? samples : data.samples;

  return (
    <section id="localization" className="section-rhythm relative overflow-hidden">
      <Aura mark="orbit" className="left-[-14%] top-8 hidden md:block" size="size-[440px]" />
      <div className="container-k">
        <div className="grid items-start gap-14 lg:grid-cols-[1fr_0.9fr] lg:gap-10">
          {/* ── Copy + controls ────────────────────────────────── */}
          <div>
            <SectionHeading index="07" eyebrow="Localization" title={data.title} lead={data.subtitle} />

            {/* language chips */}
            <RevealGroup className="mt-9 flex flex-wrap gap-2" stagger={0.05} amount={0.3}>
              <RevealItem>
                <ChipButton active={lang === null} onClick={() => setLang(null)}>
                  همه
                </ChipButton>
              </RevealItem>
              {data.languages.map((l) => (
                <RevealItem key={l.code}>
                  <ChipButton
                    active={lang === l.code}
                    onClick={() => setLang(lang === l.code ? null : l.code)}
                  >
                    <span dir={l.code === "en" || l.code === "tr" ? "ltr" : "rtl"}>
                      {l.label}
                    </span>
                  </ChipButton>
                </RevealItem>
              ))}
            </RevealGroup>

            {/* local topics */}
            <Reveal delay={0.1} className="mt-10">
              <p className="eyebrow">Local topics</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.localTopics.map((t, i) => (
                  <motion.span
                    key={t}
                    className="rounded-full border border-line bg-card px-3.5 py-2 text-[16px] text-ink-2 shadow-e1"
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ ...springSoft, delay: 0.05 * i }}
                  >
                    {t}
                  </motion.span>
                ))}
              </div>
            </Reveal>
          </div>

          {/* ── Samples + globe ────────────────────────────────── */}
          <Reveal delay={0.08} className="relative">
            <ul className="relative flex flex-col gap-3 sm:ps-10">
              {visible.map((s, i) => (
                <motion.li
                  key={s.id}
                  layout
                  initial={{ opacity: 0, x: 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...springSoft, delay: 0.08 * i }}
                  whileHover={prefersReduced ? undefined : { y: -5 }}
                  className="flex items-center gap-4 rounded-lg border border-line bg-card p-3.5 shadow-e2"
                >
                  <CoverArt
                    src={s.coverUrl || undefined}
                    alt={`کاور ${s.title}`}
                    index={i + 2}
                    rounded="rounded-sm"
                    className="size-14 shrink-0"
                    sizes="56px"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-bold text-ink">{s.title}</p>
                    <p className="mt-0.5 text-[15px] text-muted">
                      {data.languages.find((l) => l.code === s.language)?.label ??
                        s.language}
                    </p>
                  </div>
                  <span className="tnum shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-[13px] font-semibold uppercase text-violet-700">
                    {s.language}
                  </span>
                </motion.li>
              ))}
            </ul>

            {/*
              The globe sits below the stack rather than behind it. Tucked in as
              a background layer it was clipped by the container gutter and read
              as a stray shape; on its own line it becomes the section's anchor
              image and the sample cards stay legible.
            */}
            <div className="mt-10 flex justify-center lg:mt-12">
              <Float
                className="w-[220px] sm:w-[260px] lg:w-[280px]"
                amplitude={10}
                duration={8}
                rotate={1.5}
              >
                <AssetSlot
                  src={asset("localizationGlobe")}
                  alt="کره زمین سه‌بعدی"
                  label="کره زمین سه‌بعدی"
                  ratio="297 / 255"
                  tone="violet"
                  rounded="rounded-full"
                />
              </Float>
            </div>
          </Reveal>
        </div>
      </div>

      {/* full-bleed ticker of local topics — the section's closing beat */}
      <div className="mt-10 border-y sm:mt-16 border-line bg-paper-2/60 py-4">
        <Marquee speed={40}>
          {[...data.localTopics, ...data.languages.map((l) => l.label)].map((t, i) => (
            <span key={`${t}-${i}`} className="flex items-center gap-3 whitespace-nowrap">
              <span className="text-[18px] font-medium text-ink-2">{t}</span>
              <span className="size-1 rounded-full bg-violet/50" />
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative cursor-pointer rounded-full px-4 py-2.5 text-[16px] font-medium transition-colors duration-200",
        active ? "text-white" : "border border-line-2 text-ink-2 hover:border-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="lang-chip"
          className="absolute inset-0 -z-10 rounded-full bg-violet shadow-violet"
          transition={springSoft}
        />
      )}
      {children}
    </button>
  );
}
