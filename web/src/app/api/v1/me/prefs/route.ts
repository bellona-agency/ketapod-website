import { prefsOf } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Playback and notification settings.
 *
 * Server-held rather than kept in `localStorage`, because the spec's whole
 * premise is that a listener moves between the web and the phone mid-book. A
 * preferred speed that lives in one browser is a preference the app has never
 * heard of, and the listener re-sets it on every device forever.
 *
 * PATCH is field-by-field: a client that only knows about three of these must
 * not blank the other five by sending a whole object it built from an older
 * version of this contract.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  return Response.json({ prefs: prefsOf(auth.user.id) });
}

/** The rates the player offers. Validated here so a crafted value cannot
 *  produce a 30× playback that the UI has no chip for. */
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIPS = [10, 15, 30, 45, 60];

export async function PATCH(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const prefs = prefsOf(auth.user.id);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.playbackRate === "number" && RATES.includes(body.playbackRate)) {
    prefs.playbackRate = body.playbackRate;
  }
  if (typeof body.skipForwardSec === "number" && SKIPS.includes(body.skipForwardSec)) {
    prefs.skipForwardSec = body.skipForwardSec;
  }
  if (typeof body.skipBackSec === "number" && SKIPS.includes(body.skipBackSec)) {
    prefs.skipBackSec = body.skipBackSec;
  }
  if (typeof body.autoplayNextChapter === "boolean") {
    prefs.autoplayNextChapter = body.autoplayNextChapter;
  }
  if (
    body.preferredNarrator === "human" ||
    body.preferredNarrator === "ai" ||
    body.preferredNarrator === "any"
  ) {
    prefs.preferredNarrator = body.preferredNarrator;
  }
  if (typeof body.preferredDialect === "string" || body.preferredDialect === null) {
    prefs.preferredDialect = (body.preferredDialect as string | null) || null;
  }

  if (body.notify && typeof body.notify === "object") {
    const incoming = body.notify as Record<string, unknown>;
    for (const key of ["renewal", "kidsActivity", "recap", "newRelease"] as const) {
      if (typeof incoming[key] === "boolean") prefs.notify[key] = incoming[key];
    }
  }

  return Response.json({ prefs });
}
