"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Hides the site header and footer inside kids mode.
 *
 * Not cosmetic. The spec requires that leaving kids mode go through the
 * parent's PIN — «کودک نباید بتواند خارج شود» — and the site chrome is a
 * bandolier of ways around it: the nav, the search box, the logo, and a footer
 * of links, every one of them a route into the adult catalogue. Rendering it
 * over the kids shelf would make the lock decorative.
 *
 * The spec's own note on the Flutter shell makes the same point about
 * deep-links: kids safety belongs to the shell, and a route that escapes the
 * active service has to be refused there rather than trusted not to be taken.
 *
 * Path-based so it needs no change to any route, and `/kids` itself stays
 * dressed — that page is the parent-facing landing page and one of the site's
 * indexable surfaces. Only `/kids/[childId]` and below are bare.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inKidsMode = /^\/kids\/[^/]+/.test(pathname ?? "");
  if (inKidsMode) return null;
  return <>{children}</>;
}
