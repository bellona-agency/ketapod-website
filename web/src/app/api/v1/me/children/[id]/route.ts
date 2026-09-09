import type { NextRequest } from "next/server";
import { BOOKS } from "@/lib/catalog";
import { db } from "@/lib/mock/db";
import { kidsCatalogue, screenTime, weeklyReport } from "@/lib/mock/kidsPolicy";
import { requireUser } from "@/lib/mock/session";

/** Ownership, in one place. Anything that skips this leaks another family. */
async function ownedChild(req: Request, id: string) {
  const auth = await requireUser(req);
  if (auth.response) return { response: auth.response };
  const child = db.children.find(
    (c) => c.id === id && c.parentUserId === auth.user.id,
  );
  if (!child) {
    return { response: Response.json({ error: "unknown_profile" }, { status: 404 }) };
  }
  return { child };
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/me/children/[id]">,
) {
  const { id } = await ctx.params;
  const found = await ownedChild(req, id);
  if (found.response) return found.response;
  const { child } = found;

  return Response.json({
    child,
    screenTime: screenTime(child),
    report: weeklyReport(child),
    /* What the child would see right now, so the parent is approving against
       the same list the policy will actually serve. */
    shelf: kidsCatalogue(child).map((b) => ({ slug: b.slug, title: b.title })),
  });
}

/**
 * Update settings.
 *
 * A merge rather than a replace: the parent panel edits one control at a time,
 * and a PUT that overwrote the whole record would let a stale form wipe a cap
 * that was set from another device a moment earlier.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/me/children/[id]">,
) {
  const { id } = await ctx.params;
  const found = await ownedChild(req, id);
  if (found.response) return found.response;
  const { child } = found;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.name === "string" && body.name.trim()) child.name = body.name.trim();
  if (body.age !== undefined) {
    child.age = Math.min(Math.max(Math.round(Number(body.age) || child.age), 2), 14);
  }
  if (body.dailyCapMinutes !== undefined) {
    child.dailyCapMinutes =
      body.dailyCapMinutes === null
        ? null
        : Math.max(5, Math.round(Number(body.dailyCapMinutes) || 0));
  }
  if (typeof body.approvedOnly === "boolean") child.approvedOnly = body.approvedOnly;

  /* Approve and block are sent as a slug plus a verb rather than as whole
     arrays, so two devices editing different titles do not clobber each other. */
  const slug = typeof body.slug === "string" ? body.slug : null;
  if (slug) {
    /* Reject slugs that are not in the catalogue. Without this a typo is stored
       verbatim and silently does nothing — an approval that the parent can see
       in their list but that never widens the shelf, which reads as the filter
       being broken rather than as a bad slug. */
    if (!BOOKS.some((b) => b.slug === slug)) {
      return Response.json({ error: "unknown_book", slug }, { status: 422 });
    }
    const drop = (list: string[]) => list.filter((s) => s !== slug);
    if (body.decision === "allow") {
      child.blockedBookSlugs = drop(child.blockedBookSlugs);
      if (!child.allowedBookSlugs.includes(slug)) child.allowedBookSlugs.push(slug);
    } else if (body.decision === "block") {
      child.allowedBookSlugs = drop(child.allowedBookSlugs);
      if (!child.blockedBookSlugs.includes(slug)) child.blockedBookSlugs.push(slug);
    } else if (body.decision === "clear") {
      child.allowedBookSlugs = drop(child.allowedBookSlugs);
      child.blockedBookSlugs = drop(child.blockedBookSlugs);
    }
  }

  return Response.json({ child, screenTime: screenTime(child) });
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/me/children/[id]">,
) {
  const { id } = await ctx.params;
  const found = await ownedChild(req, id);
  if (found.response) return found.response;

  db.children = db.children.filter((c) => c.id !== id);
  /* The history goes with the profile. A child's listening record has no
     meaning once the profile is gone, and keeping it would be holding data
     about a minor for no purpose. */
  db.listening = db.listening.filter((s) => s.childProfileId !== id);
  return Response.json({ ok: true });
}
