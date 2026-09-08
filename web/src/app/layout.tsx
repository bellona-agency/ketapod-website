import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PageBackdrop } from "@/components/primitives/PageBackdrop";
import { Footer } from "@/components/sections/Footer";
import { Header } from "@/components/sections/Header";
import { JsonLd, SITE_NAME } from "@/lib/seo";
import { absolute, routes, SITE_URL } from "@/lib/routes";
import "./globals.css";

/**
 * IRANYekan Web, per the brand sheet. Self-hosted rather than pulled from a CDN
 * so the page controls its own loading and there is no third-party request on
 * first paint. Sources are the `fanum` cuts, which carry Persian numerals.
 *
 * The family has no SemiBold, so 600 maps to Bold — 600 is what the buttons and
 * labels use, and Medium there reads too light against the 18px body.
 *
 * Only the weights the page actually sets are shipped (400/500/600/700/800);
 * Light and Black were 50KB of font nothing referenced.
 */
const iranYekan = localFont({
  variable: "--font-yekan",
  display: "swap",
  fallback: ["Vazirmatn", "ui-sans-serif", "system-ui", "sans-serif"],
  src: [
    { path: "../fonts/IRANYekan-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/IRANYekan-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/IRANYekan-700.woff2", weight: "600", style: "normal" },
    { path: "../fonts/IRANYekan-700.woff2", weight: "700", style: "normal" },
    { path: "../fonts/IRANYekan-800.woff2", weight: "800", style: "normal" },
  ],
});

/**
 * Root metadata. Every page overrides `title` and `description` through
 * `pageMetadata`; what stays here is the part that is true site-wide.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "کتاپاد | کتاب صوتی هوشمند، متناسب با هر شنونده",
    /* Pages that set a bare string still get the brand appended, so no page can
       ship a title that does not say whose site it is. */
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "کتاب صوتی فارسی با انتخاب گوینده، نسخه‌های گویشی، ترنسکریپت همگام و تجربه‌ای مستقل برای کودک.",
  applicationName: SITE_NAME,
  openGraph: {
    siteName: SITE_NAME,
    locale: "fa_IR",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* Tracks `--color-paper`. Left behind, the browser chrome frames the page in
     the old warm paper on mobile. */
  themeColor: "#f7f8fc",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={`${iranYekan.variable} antialiased`}>
      <body>
        {/*
          Chrome moved out of the home page and into the layout when the site
          became a set of routes. The backdrop in particular has to live here:
          it is a `fixed` colour field, and remounting it per route would flash
          the whole page background on every navigation.
        */}
        <PageBackdrop />
        <Header />
        {children}
        <Footer />

        {/* Organisation and site-search, emitted once for the whole site rather
            than per page — repeating them per route is a duplicate-entity
            signal, not a stronger one. */}
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE_NAME,
            url: SITE_URL,
            description:
              "پلتفرم کتاب صوتی فارسی با انتخاب گوینده، نسخه‌های گویشی و تجربه اختصاصی کودک.",
          }}
        />
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: SITE_URL,
            inLanguage: "fa-IR",
            potentialAction: {
              "@type": "SearchAction",
              target: {
                "@type": "EntryPoint",
                urlTemplate: `${absolute(routes.search())}?q={search_term_string}`,
              },
              "query-input": "required name=search_term_string",
            },
          }}
        />
      </body>
    </html>
  );
}
