"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/api";

/**
 * Fires a page-view once per mount. Renders nothing.
 *
 * `name` used to be hard-coded to the home page because there was only one.
 * Each route now names itself, so the funnel can tell a landing on `/book/…`
 * from a landing on `/`.
 */
export function PageView({ name, metadata }: { name: string; metadata?: Record<string, unknown> }) {
  useEffect(() => {
    trackEvent(`${name}_page_viewed`, "page", name, metadata);
    /* Deliberately mount-only: `metadata` is an object literal at every call
       site, so depending on it would refire the event on each render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return null;
}
