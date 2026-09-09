import { Play } from "lucide-react";
import { AssetSlot, Float } from "@/components/primitives/AssetSlot";
import { Cta } from "@/components/primitives/Cta";
import { Icon } from "@/components/primitives/Icon";
import { RevealGroup, RevealItem } from "@/components/primitives/Reveal";
import { HeroMockup } from "./HeroMockup";
import { asset } from "@/lib/assets";
import { HERO } from "@/lib/content";

const HIGHLIGHT_ICONS = ["sparkles", "baby", "languages", "wand"] as const;

/**
 * Section 1 — Hero.
 *
 * A server component. It used to drive a scroll-linked parallax between the
 * copy and the device, which meant a `useScroll` and two `useTransform`s
 * running from the first frame on the one screen where the browser is already
 * doing the most work. The depth it bought was a few pixels; the cost was the
 * first thing anyone feels.
 */
export function Hero() {
  return (
    <section
      id="hero"
      /* Trailing space comes from the shared rhythm; the top padding is the
         hero's alone, clearing the fixed header. */
      className="section-rhythm relative overflow-hidden pt-24 sm:pt-32 md:pt-40"
    >
      {/* ── Backdrop ─────────────────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-[-10%] size-[620px] rounded-full bg-[radial-gradient(circle,rgba(42,56,255,0.16)_0%,rgba(42,56,255,0.05)_45%,transparent_70%)]" />
        <div className="absolute top-[18%] right-[-8%] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(154,162,255,0.26)_0%,transparent_68%)]" />
        <div className="dotgrid absolute bottom-8 left-6 h-40 w-52 text-line-2/70 opacity-70 md:left-16" />
        <svg
          className="absolute -right-10 top-24 h-64 w-64 text-violet/10"
          viewBox="0 0 200 200"
          fill="none"
        >
          <circle cx="100" cy="100" r="99" stroke="currentColor" strokeDasharray="3 7" />
          <circle cx="100" cy="100" r="72" stroke="currentColor" strokeDasharray="3 7" />
        </svg>
      </div>

      <div className="container-k">
        <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
          {/* ── Copy ───────────────────────────────────────────── */}
          <RevealGroup
            className="relative z-10 max-w-[560px]"
            stagger={0.09}
            delayChildren={0.1}
            amount={0.05}
          >
            <RevealItem>
              <h1 className="text-[27px] font-extrabold leading-[1.42] tracking-[-0.015em] text-ink min-[400px]:text-[31px] sm:text-[44px] md:text-[52px]">
                {HERO.titleLead}
                <br />
                <span className="relative inline-block text-violet">
                  {HERO.titleAccent}
                  {/* hand-drawn underline, drawn on entry by a CSS dash offset */}
                  <svg
                    className="absolute -bottom-1.5 right-0 h-3 w-full text-violet/35"
                    viewBox="0 0 300 12"
                    fill="none"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <path
                      className="kp-underline"
                      pathLength={1}
                      d="M2 8.5C48 3.5 104 2 150 4.5C196 7 252 9 298 4"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </h1>
            </RevealItem>

            <RevealItem>
              <p className="mt-5 max-w-[46ch] text-[17px] leading-[1.72] sm:leading-[1.95] text-ink-2 sm:text-[20px]">
                {HERO.subtitle}
              </p>
            </RevealItem>

            <RevealItem className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Cta
                label={HERO.primaryCta.label}
                target={HERO.primaryCta.target}
                event="hero_primary_cta_clicked"
                section="hero"
                element="primary_cta"
                variant="violet"
                className="h-[60px] min-h-[60px] w-full px-8 text-[19px] sm:w-auto"
              />
              <Cta
                label={HERO.secondaryCta.label}
                target={HERO.secondaryCta.target}
                event="hero_secondary_cta_clicked"
                section="hero"
                element="secondary_cta"
                variant="ghost"
                arrow={false}
                icon={<Play className="size-4 fill-current" strokeWidth={0} aria-hidden />}
                className="h-[60px] min-h-[60px] w-full px-7 text-[19px] sm:w-auto"
              />
            </RevealItem>

            <RevealItem
              as="ul"
              className="mt-9 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-line pt-6 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6"
            >
              {HERO.highlights.map((h, i) => (
                <li key={h} className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-card text-violet ring-1 ring-line">
                    <Icon name={HIGHLIGHT_ICONS[i]} className="size-3.5" strokeWidth={1.9} />
                  </span>
                  <span className="text-[16px] font-medium text-ink-2">{h}</span>
                </li>
              ))}
            </RevealItem>
          </RevealGroup>

          {/* ── Mockup ─────────────────────────────────────────── */}
          <div className="relative flex items-center justify-center">
            {/* soft stage behind the device */}
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 -z-10 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(154,162,255,0.40)_0%,rgba(247,248,252,0)_68%)] sm:size-[520px]"
            />

            <HeroMockup />

            {/* 3D asset slots — swap in the renders via `src` */}
            <Float
              className="absolute left-0 top-2 hidden w-[136px] sm:block lg:left-[2%] xl:w-[150px]"
              amplitude={9}
              duration={7}
              rotate={2}
            >
              <AssetSlot
                src={asset("heroHeadphones")}
                alt="هدفون سه‌بعدی"
                label="هدفون سه‌بعدی — گوشه بالا-چپ"
                ratio="195 / 233"
                tone="violet"
                rounded="rounded-2xl"
                /* Above the fold: fetched with the document rather than after
                   the lazy-loading observer has had a chance to run. */
                priority
                sizes="150px"
              />
            </Float>

            <Float
              className="absolute -bottom-6 right-0 hidden w-[124px] sm:block lg:right-[3%]"
              amplitude={7}
              duration={5.5}
              delay={0.6}
              rotate={3}
            >
              <AssetSlot
                src={asset("heroWaveformCoin")}
                alt="نشان موج صوتی سه‌بعدی"
                label="نشان موج صوتی سه‌بعدی"
                ratio="1 / 1"
                tone="violet"
                rounded="rounded-2xl"
                priority
                sizes="124px"
              />
            </Float>

            {/* floating AI chip */}
            <div className="kp-chip-in absolute left-0 top-[46%] hidden items-center gap-2 rounded-full border border-line bg-card/90 px-3 py-2 shadow-e3 backdrop-blur-sm md:flex lg:left-[-2%]">
              <span className="grid size-7 place-items-center rounded-full bg-violet text-white">
                <Icon name="brain" className="size-3.5" strokeWidth={2} />
              </span>
              <span className="text-[15px] font-semibold text-ink">مطابق سلیقه تو</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
