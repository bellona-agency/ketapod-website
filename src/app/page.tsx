import dynamic from "next/dynamic";
import type { Metadata } from "next";
import { PageView } from "@/components/primitives/PageView";
import { Faq } from "@/components/sections/Faq";
import { Features } from "@/components/sections/Features";
import { FinalCta } from "@/components/sections/FinalCta";
import { Hero } from "@/components/sections/Hero";
import { HomeCatalog } from "@/components/sections/HomeCatalog";
import { Kids } from "@/components/sections/Kids";
import { LeadIntentFromUrl } from "@/components/sections/LeadIntentFromUrl";
import { Problem } from "@/components/sections/Problem";
import { WhyUs } from "@/components/sections/WhyUs";
import {
  getDemo,
  getLeadOptions,
  getLocalization,
  getSocialProof,
  SECTION_REVALIDATE,
} from "@/lib/api";
import { routes } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "کتاپاد | کتاب صوتی هوشمند، متناسب با هر شنونده",
  description:
    "کتاب صوتی فارسی با انتخاب گوینده، نسخه‌های گویشی، ترنسکریپت همگام و تجربه‌ای مستقل و امن برای کودک.",
  path: routes.home(),
});

/*
 * These four are the only sections left that still need an animation library,
 * and they are also the four nobody can see on arrival: the audio player and
 * its state machine, the validated lead form, and the two API-backed rails.
 *
 * Split out, they still server-render into the HTML — no `loading` fallback and
 * no `ssr: false`, so nothing flashes and the content is in the document for
 * crawlers. Only their JavaScript becomes a separate chunk, so it stops
 * competing with hydrating the part of the page that is actually on screen.
 */
const InteractiveDemo = dynamic(() =>
  import("@/components/sections/InteractiveDemo").then((m) => m.InteractiveDemo),
);

const Localization = dynamic(() =>
  import("@/components/sections/Localization").then((m) => m.Localization),
);

const SocialProof = dynamic(() =>
  import("@/components/sections/SocialProof").then((m) => m.SocialProof),
);

const LeadForm = dynamic(() =>
  import("@/components/sections/LeadForm").then((m) => m.LeadForm),
);

/**
 * The home page.
 *
 * Still the pitch, and still the only page with the lead form on it — every CTA
 * anywhere on the site ends here. What changed is that it is no longer the whole
 * site: the header, footer and backdrop moved to the layout, and `HomeCatalog`
 * now links out to the catalogue, the dialect pages and the narrators rather
 * than describing them.
 *
 * The four API-backed sections are read here rather than from a `useEffect` in
 * each one. Fetched in the browser they were four independent round trips that
 * could not even start until hydration finished, and each section rendered its
 * fallback copy until its own request landed. Read here they are one parallel
 * batch on the server, cached for `SECTION_REVALIDATE`, and the real copy is in
 * the first HTML response.
 *
 * `getOrFallback` still absorbs a failing endpoint per section, so a dead API
 * degrades the same way it always did — it just no longer does it in front of
 * the reader.
 */
export default async function HomePage() {
  const opts = { revalidate: SECTION_REVALIDATE };
  const [demo, localization, socialProof, leadOptions] = await Promise.all([
    getDemo(opts),
    getLocalization(opts),
    getSocialProof(opts),
    getLeadOptions(opts),
  ]);

  return (
    <>
      <PageView name="home" />
      <LeadIntentFromUrl />
      <main>
        <Hero />
        <WhyUs />
        <HomeCatalog />
        <Problem />
        <Features />
        <InteractiveDemo demo={demo} />
        <Kids />
        <Localization data={localization} />
        <SocialProof data={socialProof} />
        <Faq />
        <LeadForm options={leadOptions} />
        <FinalCta />
      </main>
    </>
  );
}
