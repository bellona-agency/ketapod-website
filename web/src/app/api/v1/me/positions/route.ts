import { dayKey, db, findEditionById, hasEntitlement, uid } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Cross-device playback position.
 *
 * The spec's rule, followed exactly: keyed on user × AudioEdition, written with
 * a debounce every ten seconds and on pause, conflicts resolved last-write-wins
 * on the *device* clock. The client therefore sends its own `updatedAt`, and a
 * write that is older than the stored one is accepted and discarded rather than
 * rejected — a phone that was offline replaying its queue must not clobber the
 * laptop that has since moved on, and must not see an error for it either.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const editionId = new URL(req.url).searchParams.get("editionId");
  const rows = db.positions.filter(
    (p) => p.userId === auth.user.id && (!editionId || p.editionId === editionId),
  );
  return Response.json({ positions: rows });
}

export async function PUT(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    editionId?: string;
    positionSec?: number;
    updatedAt?: string;
  };

  const found = body.editionId ? findEditionById(body.editionId) : undefined;
  if (!found) {
    return Response.json({ error: "unknown_edition" }, { status: 404 });
  }

  /* A position is a claim about something you are allowed to play. Without this
     check the endpoint would happily record progress through a book the caller
     never obtained, and the shelf is built from entitlements anyway. */
  if (!hasEntitlement(user.id, found.edition.id)) {
    return Response.json({ error: "not_entitled" }, { status: 403 });
  }

  const positionSec = clamp(body.positionSec ?? 0, 0, found.edition.durationSec);
  const incoming = body.updatedAt ?? new Date().toISOString();

  const existing = db.positions.find(
    (p) => p.userId === user.id && p.editionId === found.edition.id,
  );

  if (!existing) {
    const row = {
      userId: user.id,
      editionId: found.edition.id,
      positionSec,
      updatedAt: incoming,
    };
    db.positions.push(row);
    return Response.json({ position: row, applied: true });
  }

  if (Date.parse(incoming) < Date.parse(existing.updatedAt)) {
    return Response.json({ position: existing, applied: false, reason: "stale_write" });
  }

  /* Bank the forward movement as listened time.
     The dashboard needs elapsed minutes and a position cannot supply them — it
     is a bookmark, so it moves backwards on a replay and sideways on a seek.
     The *delta* between two accepted writes is real listening, which is why it
     is recorded here rather than inferred later from the stored value.
     Only forward movement counts, and only movement small enough to have been
     played in the time since the last write: a seek across a chapter is a jump,
     not an hour of listening. */
  const delta = positionSec - existing.positionSec;
  const sinceLastWriteSec =
    (Date.parse(incoming) - Date.parse(existing.updatedAt)) / 1000;
  if (delta > 0 && delta <= Math.max(sinceLastWriteSec * 3, 30)) {
    bankListening(user.id, found.edition.id, delta);
  }

  existing.positionSec = positionSec;
  existing.updatedAt = incoming;
  return Response.json({ position: existing, applied: true });
}

/** One row per account, edition and day; seconds accumulate into it. */
function bankListening(userId: string, editionId: string, seconds: number) {
  const day = dayKey();
  const row = db.listening.find(
    (s) =>
      s.userId === userId &&
      s.childProfileId === null &&
      s.editionId === editionId &&
      s.day === day,
  );
  if (row) {
    row.seconds += seconds;
    return;
  }
  db.listening.push({
    id: `ls_${uid()}`,
    childProfileId: null,
    userId,
    editionId,
    day,
    seconds,
    startedAt: new Date().toISOString(),
  });
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
