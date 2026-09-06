/**
 * The site's URL map.
 *
 * Every indexable surface in the spec's "وب عمومی" row gets its own path, and
 * every one of them is built here rather than interpolated at the call site —
 * a slug that changes shape then breaks the build in one file instead of
 * silently 404-ing from a handful of cards.
 */

export const SITE_URL = "https://ketapod.ir";

export const routes = {
  home: () => "/",
  books: () => "/books",
  /* Its own route rather than `/books?q=`. A page that reads `searchParams` is
     dynamic for every visitor, which would have cost the catalogue hub — the
     most-crawled page after the home page — its static HTML, purely to support
     an optional parameter most visitors never set. */
  search: (query?: string) => (query ? `/search?q=${encodeURIComponent(query)}` : "/search"),
  book: (slug: string) => `/book/${slug}`,
  author: (slug: string) => `/author/${slug}`,
  publisher: (slug: string) => `/publisher/${slug}`,
  category: (slug: string) => `/category/${slug}`,
  collection: (slug: string) => `/collection/${slug}`,
  voices: () => "/voices",
  voice: (slug: string) => `/voice/${slug}`,
  dialects: () => "/dialects",
  dialect: (slug: string) => `/dialect/${slug}`,
  kids: () => "/kids",
  ai: () => "/ai",
  blog: () => "/blog",
  blogPost: (slug: string) => `/blog/${slug}`,
  privacy: () => "/privacy",
  terms: () => "/terms",
} as const;

/** Absolute form, for canonical tags, JSON-LD and the sitemap. */
export const absolute = (path: string) => `${SITE_URL}${path}`;

/**
 * The lead form lives on the home page and is the only conversion point on the
 * public site, so every CTA away from home is a link back to it rather than a
 * duplicated form. Kept as one constant because it appears in the header, the
 * footer and roughly a dozen section CTAs.
 */
export const LEAD_HREF = "/#lead-form";

/* ── Primary navigation ──────────────────────────────────────────────────—
   Ordered by the funnel the spec describes, not by importance to us: the
   catalogue is what search traffic lands on, `/ai` is the acquisition page,
   and kids is a separate entry because a parent searching for children's audio
   should never have to pass through the adult catalogue to find it.          */

export const NAV_LINKS = [
  { label: "کتاب‌ها", href: routes.books() },
  { label: "کتاب‌یار", href: routes.ai() },
  { label: "کودک", href: routes.kids() },
  { label: "گویش‌ها", href: routes.dialects() },
  { label: "گویندگان", href: routes.voices() },
  { label: "بلاگ", href: routes.blog() },
] as const;

/**
 * True when `href` is the current page or an ancestor of it.
 *
 * Detail pages sit on their own path segment (`/book/…` under `/books`), so a
 * plain equality check would leave the whole catalogue branch showing no active
 * nav item. The home route is special-cased because every path starts with "/".
 */
export function isActivePath(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (pathname.startsWith(href)) return true;

  /* `/book/[slug]` and `/category/[slug]` belong to the catalogue tab; the
     singular-plural pairs are the only place this is needed. */
  const CHILD_OF: Record<string, string[]> = {
    "/books": ["/book/", "/category/", "/author/", "/publisher/", "/collection/"],
    "/voices": ["/voice/"],
    "/dialects": ["/dialect/"],
  };
  return (CHILD_OF[href] ?? []).some((prefix) => pathname.startsWith(prefix));
}
