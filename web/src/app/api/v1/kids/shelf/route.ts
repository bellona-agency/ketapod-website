import { db, hasEntitlement } from "@/lib/mock/db";
import {
  KIDS_PRESET_QUESTIONS,
  childFromRequest,
  kidsCatalogue,
  kidsEditionOf,
  screenTime,
} from "@/lib/mock/kidsPolicy";
import { requireUser } from "@/lib/mock/session";

/**
 * The child's shelf.
 *
 * Assembled entirely from the policy module, so the shape of the response *is*
 * the enforcement — there is no wider list here that a client is trusted to
 * narrow. A blocked title is not sent with a flag; it is not sent.
 *
 * `presetQuestions` ships with the shelf for the same reason. Rule 2 says the
 * child gets preset questions and never a text box, and a client that had to
 * ask a separate endpoint for them could simply not ask, and render an input.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const gate = childFromRequest(req, auth.user.id);
  if (!gate.ok) return gate.response;
  const { child } = gate;

  const books = kidsCatalogue(child);

  const items = books.flatMap((book) => {
    const edition = kidsEditionOf(book);
    if (!edition) return [];
    /* The parent's entitlement, because the child has none of their own —
       everything resolves to the account that paid. */
    if (!hasEntitlement(auth.user.id, edition.id)) return [];

    const position = db.positions.find(
      (p) => p.userId === auth.user.id && p.editionId === edition.id,
    );

    return [
      {
        bookSlug: book.slug,
        title: book.title,
        editionId: edition.id,
        durationSec: edition.durationSec,
        positionSec: position?.positionSec ?? 0,
      },
    ];
  });

  /* The spec: "ادامه شنیدن باید بزرگ‌ترین عنصر صفحه اول باشد". The server picks
     which one that is, so every client agrees on it. */
  const resume =
    items
      .filter((i) => i.positionSec > 30 && i.positionSec < i.durationSec - 30)
      .sort((a, b) => b.positionSec / b.durationSec - a.positionSec / a.durationSec)[0] ??
    null;

  return Response.json({
    child: { id: child.id, name: child.name, age: child.age, avatar: child.avatar },
    screenTime: screenTime(child),
    resume,
    items,
    presetQuestions: KIDS_PRESET_QUESTIONS,
    /* Rules 1 and 4, stated rather than implied, so a client cannot claim it
       did not know. Both are server-side facts about this profile. */
    policy: { adsAllowed: false, freeTextAssistant: false, notifiesChildDevice: false },
  });
}
