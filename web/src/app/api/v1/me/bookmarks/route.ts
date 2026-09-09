import { db, findEditionById, hasEntitlement, uid } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Bookmarks and notes.
 *
 * The spec gives bookmarks the unique key «کاربر × نسخه صوتی × زمان», so a
 * second bookmark at the same second is the same bookmark rather than a
 * duplicate row — which is what a listener tapping the button twice produces.
 * Rounding to the second before comparing is what makes that key real; without
 * it two marks 40ms apart are distinct and the list fills with near-identical
 * entries.
 *
 * Notes share the endpoint shape but not that constraint: two thoughts about
 * the same sentence are two notes, and collapsing them would lose one.
 */

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    editionId?: string;
    positionSec?: number;
    label?: string;
    body?: string;
    kind?: "bookmark" | "note";
  };

  const found = body.editionId ? findEditionById(body.editionId) : undefined;
  if (!found) return Response.json({ error: "unknown_edition" }, { status: 404 });
  if (!hasEntitlement(user.id, found.edition.id)) {
    return Response.json({ error: "not_entitled" }, { status: 403 });
  }

  const at = Math.round(
    Math.min(Math.max(body.positionSec ?? 0, 0), found.edition.durationSec),
  );
  const now = new Date().toISOString();

  if (body.kind === "note") {
    const text = (body.body ?? "").trim();
    if (!text) {
      return Response.json({ error: "empty_note" }, { status: 422 });
    }
    const note = {
      id: `note_${uid()}`,
      userId: user.id,
      editionId: found.edition.id,
      positionSec: at,
      body: text,
      createdAt: now,
    };
    db.notes.push(note);
    return Response.json({ note }, { status: 201 });
  }

  const duplicate = db.bookmarks.find(
    (b) =>
      b.userId === user.id && b.editionId === found.edition.id && b.positionSec === at,
  );
  if (duplicate) return Response.json({ bookmark: duplicate, created: false });

  const bookmark = {
    id: `bm_${uid()}`,
    userId: user.id,
    editionId: found.edition.id,
    positionSec: at,
    label: (body.label ?? "").trim() || formatStamp(at),
    createdAt: now,
  };
  db.bookmarks.push(bookmark);
  return Response.json({ bookmark, created: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 422 });

  /* Scoped to the caller, so an id from another account deletes nothing. */
  const before = db.bookmarks.length + db.notes.length;
  db.bookmarks = db.bookmarks.filter(
    (b) => !(b.id === id && b.userId === auth.user.id),
  );
  db.notes = db.notes.filter((n) => !(n.id === id && n.userId === auth.user.id));

  const removed = before - (db.bookmarks.length + db.notes.length);
  return Response.json({ ok: removed > 0 }, { status: removed > 0 ? 200 : 404 });
}

/** `1:04:09` / `4:09`. Latin digits; IRANYekan renders them Persian. */
function formatStamp(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
