import type { NextRequest } from "next/server";
import { db, findEditionById, hasEntitlement } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Everything the player needs, in one request.
 *
 * Chapters, transcript, position and bookmarks arrive together rather than as
 * four calls, because the player cannot render a first frame without all of
 * them — a transcript that lands after the audio has started scrolls the reader
 * to the wrong line, and a position that arrives late makes the play head jump.
 *
 * The entitlement check is here and not only in the UI. `transcript` is the
 * book's actual words, so serving it to someone without a grant would hand out
 * the content the grant is protecting.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/editions/[id]">,
) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await ctx.params;
  const found = findEditionById(id);
  if (!found) return Response.json({ error: "unknown_edition" }, { status: 404 });

  const { edition, book, voice } = found;
  if (!hasEntitlement(user.id, edition.id)) {
    return Response.json(
      { error: "not_entitled", message: "این نسخه در کتابخانه شما نیست." },
      { status: 403 },
    );
  }

  const position = db.positions.find(
    (p) => p.userId === user.id && p.editionId === edition.id,
  );

  return Response.json({
    editionId: edition.id,
    bookSlug: book.slug,
    title: book.title,
    narratorType: edition.narratorType,
    durationSec: edition.durationSec,
    voice: voice ? { slug: voice.slug, name: voice.name, timbre: voice.timbre } : null,

    /**
     * Empty until the media pipeline produces files.
     *
     * The spec's pipeline ends with two outputs — HLS for streaming and a
     * single m4a for download, both 48kbps mono. Neither exists yet, so the
     * player falls back to driving its own clock and says so on screen. When
     * this field is filled the same UI plays it, because nothing above the
     * playback engine reads it.
     */
    audioUrl: "",

    chapters: edition.chapters,
    /* A sample, not the whole book — the catalogue seed carries the opening
       minute. Enough for the sync to be real rather than mimed. */
    transcript: edition.transcriptSample,
    positionSec: position?.positionSec ?? 0,
    bookmarks: db.bookmarks
      .filter((b) => b.userId === user.id && b.editionId === edition.id)
      .sort((a, b) => a.positionSec - b.positionSec),
    notes: db.notes
      .filter((n) => n.userId === user.id && n.editionId === edition.id)
      .sort((a, b) => a.positionSec - b.positionSec),
  });
}
