import { findEditionById, hasEntitlement } from "@/lib/mock/db";
import { quiz, recap } from "@/lib/mock/assistant";
import { requireUser } from "@/lib/mock/session";

/**
 * "تا اینجا چه گذشت" and a quiz over the same bounded window.
 *
 * One endpoint for both because they share the only expensive decision — how
 * far the listener has got — and a client that asked separately could pass two
 * different times and get a recap that disagrees with its own quiz.
 *
 * `upToSec` defaults to the stored position rather than to the end of the book.
 * A missing parameter must not be read as "summarise everything".
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const editionId = url.searchParams.get("editionId") ?? "";
  const found = findEditionById(editionId);
  if (!found) return Response.json({ error: "unknown_edition" }, { status: 404 });
  if (!hasEntitlement(auth.user.id, found.edition.id)) {
    return Response.json({ error: "not_entitled" }, { status: 403 });
  }

  const raw = url.searchParams.get("upToSec");
  const at = Math.min(
    Math.max(raw === null ? 0 : Number(raw) || 0, 0),
    found.edition.durationSec,
  );

  return Response.json({
    recap: recap(editionId, at),
    quiz: quiz(editionId, at),
  });
}
