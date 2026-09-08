import type { Metadata } from "next";
import { absolute, SITE_URL } from "./routes";

export const SITE_NAME = "کتاپاد";

/**
 * Page metadata, in one shape.
 *
 * The spec makes indexability the reason the web surface exists, which means
 * canonical URLs, Open Graph and titles are not per-page decisions — every page
 * gets the same treatment or the inconsistency shows up as duplicate-content
 * warnings months later. This is the only place that decides how a title is
 * composed.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  publishedTime,
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  publishedTime?: string;
  noIndex?: boolean;
}): Metadata {
  /* The home page already carries the brand in its title; everything else gets
     it appended, so a search result reads "بوف کور | کتاپاد" rather than
     repeating the brand twice on one line. */
  const fullTitle = path === "/" ? title : `${title} | ${SITE_NAME}`;
  const url = absolute(path);

  return {
    /*
     * `absolute` bypasses the layout's `%s | کتاپاد` template. The brand is
     * already appended just above, and letting the template run as well turned
     * every page that came through here into "بوف کور | کتاپاد | کتاپاد".
     *
     * The template stays in the layout for any future page that sets a bare
     * string title without going through this helper.
     */
    title: { absolute: fullTitle },
    description,
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: url },
    robots: noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      locale: "fa_IR",
      type,
      ...(publishedTime ? { publishedTime } : {}),
    },
  };
}

/**
 * A JSON-LD block.
 *
 * `dangerouslySetInnerHTML` is the documented way to emit structured data in
 * React — the alternative escapes the quotes and the block stops parsing. The
 * `<` escape guards the one real risk: a `</script>` sequence inside any string
 * that reaches here from data.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/**
 * `schema.org/BreadcrumbList`.
 *
 * Deep catalogue pages are several levels from the home page, and without this
 * a search result shows the raw URL path instead of the trail. Positions are
 * 1-based, which the spec of the vocabulary requires and which is the usual
 * thing to get wrong.
 */
export function breadcrumbLd(trail: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}
