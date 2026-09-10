import { db } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * The notification centre.
 *
 * Scoped to the account and nothing else. That is rule four of the spec's kids
 * policy — «هیچ نوتیفیکیشنی به دستگاه کودک نرود --- همه به گوشی والد» — and it
 * holds here structurally rather than by a check: there is no profile filter to
 * pass, so a notification about a child's listening can only ever be read by the
 * parent whose session fetched it.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const items = db.notifications
    .filter((n) => n.userId === user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return Response.json({
    items,
    unread: items.filter((n) => n.readAt === null).length,
  });
}

/**
 * Mark read — one, or all of them.
 *
 * A POST rather than a PATCH on each row, because "من همه را دیدم" is one act
 * the user performs, and turning it into nine requests would leave the badge
 * half-cleared whenever one of them failed.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id, all } = (await req.json().catch(() => ({}))) as {
    id?: string;
    all?: boolean;
  };
  const now = new Date().toISOString();

  for (const n of db.notifications) {
    if (n.userId !== user.id || n.readAt !== null) continue;
    if (all || n.id === id) n.readAt = now;
  }

  return Response.json({
    unread: db.notifications.filter((n) => n.userId === user.id && n.readAt === null)
      .length,
  });
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const id = new URL(req.url).searchParams.get("id");
  db.notifications = db.notifications.filter(
    (n) => !(n.userId === auth.user.id && (id ? n.id === id : true)),
  );
  return Response.json({ ok: true });
}
