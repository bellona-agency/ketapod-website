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
 */
export default function HomePage() {
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
        <InteractiveDemo />
        <Kids />
        <Localization />
        <SocialProof />
        <Faq />
        <LeadForm />
        <FinalCta />
      </main>
    </>
  );
}
