import { db, uid, type ChildProfile } from "@/lib/mock/db";
import { screenTime, weeklyReport } from "@/lib/mock/kidsPolicy";
import { requireUser } from "@/lib/mock/session";

/**
 * The parent's children.
 *
 * Every route here is scoped by `parentUserId`, which is what makes the spec's
 * "subresource, not a user" decision hold at the wire rather than only in the
 * table: there is no endpoint that takes a child id without also proving the
 * caller is its parent.
 */

const AVATARS = ["fox", "owl", "whale", "robot"] as const;

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const children = db.children
    .filter((c) => c.parentUserId === auth.user.id)
    .map((child) => ({
      ...child,
      screenTime: screenTime(child),
      weekMinutes: weeklyReport(child).totalMinutes,
    }));

  return Response.json({ children });
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Partial<ChildProfile>;
  const name = (body.name ?? "").trim();
  if (!name) return Response.json({ error: "name_required" }, { status: 422 });

  /* The spec keys the kids catalogue and the assistant's safety rules off age,
     so it is required rather than optional, and clamped to the range the
     product actually serves. */
  const age = Math.min(Math.max(Math.round(Number(body.age) || 0), 2), 14);
  if (!age) return Response.json({ error: "age_required" }, { status: 422 });

  const child: ChildProfile = {
    id: `chp_${uid()}`,
    parentUserId: auth.user.id,
    name,
    age,
    dailyCapMinutes:
      body.dailyCapMinutes === null ? null : Number(body.dailyCapMinutes) || 45,
    allowedBookSlugs: [],
    blockedBookSlugs: [],
    approvedOnly: false,
    avatar: AVATARS.includes(body.avatar as (typeof AVATARS)[number])
      ? (body.avatar as (typeof AVATARS)[number])
      : "fox",
    createdAt: new Date().toISOString(),
  };

  db.children.push(child);
  return Response.json({ child }, { status: 201 });
}
