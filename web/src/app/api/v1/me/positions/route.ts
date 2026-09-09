import { db, findEditionById, hasEntitlement } from "@/lib/mock/db";
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

  existing.positionSec = positionSec;
  existing.updatedAt = incoming;
  return Response.json({ position: existing, applied: true });
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
