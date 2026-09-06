import { scrollToSection } from "./utils";

export type LeadIntent = {
  /** Preselects the user-type field (e.g. `parent` from the Kids CTA). */
  userType?: string;
  /** Preselects an interest tag when the user hasn't picked any yet. */
  interest?: string;
};

type Listener = (intent: LeadIntent) => void;

const listeners = new Set<Listener>();

/**
 * An intent that arrived before the form was listening.
 *
 * The form is dynamically imported and sits near the bottom of the page, so
 * "nobody is subscribed yet" is a real state, not a theoretical one — and an
 * intent broadcast into an empty listener set used to vanish silently. Holding
 * the last one and replaying it on subscribe makes the channel order-independent.
 */
let pending: LeadIntent | null = null;

/**
 * Tiny broadcast channel between a CTA anywhere on the page and the lead form.
 * A context would mean turning the whole page into a client tree for two
 * optional strings; this keeps the sections independently renderable.
 */
export function onLeadIntent(cb: Listener) {
  listeners.add(cb);

  if (pending) {
    const replay = pending;
    pending = null;
    cb(replay);
  }

  return () => {
    listeners.delete(cb);
  };
}

export function openLeadForm(intent: LeadIntent = {}) {
  if (listeners.size === 0) pending = intent;
  else listeners.forEach((l) => l(intent));
  scrollToSection("lead-form");
}

/* ── Cross-page intent ───────────────────────────────────────────────────—
   The broadcast above only works when the form is already mounted, which was
   true when the site was one page. It is not true from `/kids` or `/ai`: the
   form lives on the home route, so by the time it mounts the CTA that had
   something to say about it is long gone.

   So an intent that has to survive a navigation travels in the URL instead.
   Two query parameters, deliberately prefixed, so they cannot collide with the
   catalogue's own `?q=`.                                                     */

const USER_TYPE_PARAM = "lead_u";
const INTEREST_PARAM = "lead_i";

/** `/?lead_u=parent&lead_i=kids#lead-form` — a real href, crawlable and shareable. */
export function leadHref(intent: LeadIntent = {}) {
  const params = new URLSearchParams();
  if (intent.userType) params.set(USER_TYPE_PARAM, intent.userType);
  if (intent.interest) params.set(INTEREST_PARAM, intent.interest);
  const query = params.toString();
  return `/${query ? `?${query}` : ""}#lead-form`;
}

/**
 * The intent carried by the current URL, if any.
 *
 * Read once by the form on mount. Returns null rather than an empty object so
 * the caller can tell "no intent" from "an intent with nothing in it" — only
 * the first should move focus into the form.
 */
export function intentFromLocation(search: string): LeadIntent | null {
  const params = new URLSearchParams(search);
  const userType = params.get(USER_TYPE_PARAM) ?? undefined;
  const interest = params.get(INTEREST_PARAM) ?? undefined;
  if (!userType && !interest) return null;
  return { userType, interest };
}
