import { findEditionById, hasEntitlement } from "@/lib/mock/db";
import { heardCues, provider, retrieve } from "@/lib/mock/assistant";
import {
  KIDS_PRESET_QUESTIONS,
  PROFILE_HEADER,
  childFromRequest,
  mayPlayEdition,
} from "@/lib/mock/kidsPolicy";
import { requireUser } from "@/lib/mock/session";

/**
 * Ask کتاب‌یار about the book, from where the listener is standing.
 *
 * The spec's contract for this endpoint is that the request carries
 * `bookId + chapterId + currentTime`, and that is not telemetry — `currentTime`
 * is what bounds the corpus. Everything the answer can be built from is behind
 * `heardCues`, so the spoiler rule is enforced by what the retriever can see
 * rather than by asking a model to behave.
 *
 * When `X-Profile-Id` is present this is a child asking, and rule 2 applies:
 * preset questions only, checked here. The kids UI renders no text input at
 * all, but a UI that renders no input is a UI decision, and this is the rule.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    editionId?: string;
    chapterId?: number | null;
    currentTimeSec?: number;
    question?: string;
  };

  const found = body.editionId ? findEditionById(body.editionId) : undefined;
  if (!found) return Response.json({ error: "unknown_edition" }, { status: 404 });
  if (!hasEntitlement(user.id, found.edition.id)) {
    return Response.json({ error: "not_entitled" }, { status: 403 });
  }

  const question = (body.question ?? "").trim();
  if (!question) return Response.json({ error: "empty_question" }, { status: 422 });

  /* Rule 2, server-side. */
  if (req.headers.get(PROFILE_HEADER)) {
    const gate = childFromRequest(req, user.id);
    if (!gate.ok) return gate.response;
    if (!mayPlayEdition(gate.child, found.edition.id)) {
      return Response.json({ error: "not_permitted" }, { status: 403 });
    }
    if (!KIDS_PRESET_QUESTIONS.includes(question)) {
      return Response.json(
        {
          error: "free_text_not_allowed",
          message: "برای پروفایل کودک فقط پرسش‌های آماده مجاز است.",
          allowed: KIDS_PRESET_QUESTIONS,
        },
        { status: 403 },
      );
    }
  }

  /* Clamped to the edition: a client that sends a time past the end would
     otherwise widen the corpus to the whole book, which is the spoiler the
     guard exists to prevent. */
  const at = Math.min(
    Math.max(body.currentTimeSec ?? 0, 0),
    found.edition.durationSec,
  );

  const heard = heardCues(found.edition.transcriptSample, at);
  const passages = retrieve(heard, question);
  const answer = await provider.ask(
    {
      editionId: found.edition.id,
      chapterId: body.chapterId ?? null,
      currentTimeSec: at,
      question,
    },
    passages,
  );

  return Response.json({
    ...answer,
    provider: provider.id,
    /* Returned so the client can be honest about the bound rather than
       implying the assistant has read the whole book. */
    context: { heardCues: heard.length, upToSec: at },
  });
}
