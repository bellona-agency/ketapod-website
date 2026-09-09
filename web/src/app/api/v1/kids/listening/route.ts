import { dayKey, db, uid } from "@/lib/mock/db";
import { childFromRequest, mayPlayEdition, screenTime } from "@/lib/mock/kidsPolicy";
import { requireUser } from "@/lib/mock/session";

/**
 * Record elapsed listening for a child, and return what is left of today.
 *
 * The spec splits the screen-time cap deliberately: enforcement on the device
 * so it survives being offline, the setting and the tally on the server. This
 * is the server half. It accepts elapsed seconds, adds them to today, and
 * answers with the remaining budget — a client that has been offline sends its
 * accumulated seconds on reconnect and gets a corrected figure back.
 *
 * It is also the second gate on playback. `mayPlayEdition` re-checks the
 * policy, so a child who is somehow pointed at a blocked or adult edition
 * cannot bank time against it even if a client let them start.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const gate = childFromRequest(req, auth.user.id);
  if (!gate.ok) return gate.response;
  const { child } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    editionId?: string;
    seconds?: number;
  };

  if (!body.editionId || !mayPlayEdition(child, body.editionId)) {
    return Response.json({ error: "not_permitted" }, { status: 403 });
  }

  /* Clamped: a client that slept and woke could otherwise report hours at once
     and burn the whole cap, and a negative would hand time back. One hour is
     more than any single uninterrupted sitting the cap allows. */
  const seconds = Math.min(Math.max(Math.round(body.seconds ?? 0), 0), 3600);
  const day = dayKey();

  const existing = db.listening.find(
    (s) =>
      s.childProfileId === child.id && s.editionId === body.editionId && s.day === day,
  );

  if (existing) {
    existing.seconds += seconds;
  } else {
    db.listening.push({
      id: `ls_${uid()}`,
      childProfileId: child.id,
      userId: auth.user.id,
      editionId: body.editionId,
      day,
      seconds,
      startedAt: new Date().toISOString(),
    });
  }

  return Response.json({ screenTime: screenTime(child) });
}
