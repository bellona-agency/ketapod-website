import { db, findEditionById } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * The listener's shelf.
 *
 * Built from entitlements rather than from orders, which is the whole point of
 * the spec keeping those separate: a gifted book, a subscription title and an
 * organisation seat all belong on the shelf, and none of them is a purchase by
 * this user.
 *
 * The row is flattened server-side — book, voice, position and progress
 * resolved into one object — for the same reason the public book page resolves
 * its editions on the server: a client that has to join `voiceId` against a
 * separate voices list can render a narrator that has no audio behind it.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const now = Date.now();
  const items = db.entitlements
    .filter((e) => e.userId === user.id)
    .map((ent) => {
      const found = findEditionById(ent.editionId);
      if (!found) return null;

      const { edition, book, voice } = found;
      const position = db.positions.find(
        (p) => p.userId === user.id && p.editionId === edition.id,
      );
      const expired = ent.expiresAt !== null && Date.parse(ent.expiresAt) <= now;

      return {
        entitlementId: ent.id,
        source: ent.source,
        expiresAt: ent.expiresAt,
        /* Expired rows stay on the shelf but are marked. Removing them makes a
           lapsed subscription look like data loss to the person who had it. */
        expired,
        editionId: edition.id,
        bookSlug: book.slug,
        title: book.title,
        authorSlug: book.authorSlug,
        narratorType: edition.narratorType,
        dialectSlug: edition.dialectSlug ?? null,
        durationSec: edition.durationSec,
        voice: voice ? { slug: voice.slug, name: voice.name } : null,
        positionSec: position?.positionSec ?? 0,
        progress: position ? position.positionSec / edition.durationSec : 0,
        lastPlayedAt: position?.updatedAt ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  /* Continue-listening order: most recently played first, then never-played.
     The spec makes "ادامه شنیدن" the primary action on every surface, so the
     default sort has to put the thing being continued at the top. */
  items.sort((a, b) => {
    if (a.lastPlayedAt && b.lastPlayedAt) {
      return Date.parse(b.lastPlayedAt) - Date.parse(a.lastPlayedAt);
    }
    if (a.lastPlayedAt) return -1;
    if (b.lastPlayedAt) return 1;
    return a.title.localeCompare(b.title, "fa");
  });

  return Response.json({
    items,
    continueListening: items.find((i) => !i.expired && i.progress > 0.01 && i.progress < 0.98) ?? null,
  });
}
