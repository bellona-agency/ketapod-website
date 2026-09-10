import { cookies } from "next/headers";
import { tierSpec } from "@/lib/mock/commerce";
import { activeSubscription, balanceOf, db } from "@/lib/mock/db";
import { SESSION_COOKIE, requireUser } from "@/lib/mock/session";

/**
 * The session bootstrap the whole authenticated surface reads.
 *
 * Returns the viewer plus the two numbers every screen in the shell shows — the
 * wallet balance and how many entitlements are live — so the header does not
 * need three requests to render. Roles are included because the spec gates the
 * studio tile on `creator` and the moderation panel on `admin`, and that
 * decision belongs to the server.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const now = Date.now();
  const live = db.entitlements.filter(
    (e) =>
      e.userId === user.id && (e.expiresAt === null || Date.parse(e.expiresAt) > now),
  );

  const sub = activeSubscription(user.id);

  return Response.json({
    id: user.id,
    phone: user.phone,
    name: user.name ?? null,
    roles: user.roles,
    createdAt: user.createdAt,
    referralCode: user.referralCode,
    walletBalanceRial: balanceOf(user.id),
    entitlementCount: live.length,
    deviceCount: db.devices.filter((d) => d.userId === user.id).length,
    unreadNotifications: db.notifications.filter(
      (n) => n.userId === user.id && n.readAt === null,
    ).length,
    /* Summarised rather than embedded whole: the shell needs to know whether to
       show a plan badge and how many days are left, and a screen that wants the
       rest asks `/me/subscription`. */
    subscription: sub
      ? {
          tier: sub.tier,
          tierName: tierSpec(sub.tier).name,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          daysLeft: Math.max(
            0,
            Math.ceil((Date.parse(sub.currentPeriodEnd) - now) / 86_400_000),
          ),
        }
      : null,
  });
}

/**
 * Edit the profile.
 *
 * Only the display name. The phone is the login identity and changing it is a
 * re-verification flow, not a field edit — a PATCH that silently moved an
 * account onto a new number would be the shortest account-takeover in the
 * product.
 */
export async function PATCH(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as { name?: string };

  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 60);
    if (name.length < 2) {
      return Response.json(
        { error: "name_too_short", message: "نام باید دست‌کم دو حرف باشد." },
        { status: 422 },
      );
    }
    user.name = name;
  }

  return Response.json({ id: user.id, name: user.name ?? null, phone: user.phone });
}

/** Sign out. Drops the session row so the refresh token is genuinely dead. */
export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;

  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (value) {
    const session = db.sessions.find((s) => s.refreshToken === value);
    if (session) {
      db.devices = db.devices.filter((d) => d.id !== session.deviceId);
      db.sessions = db.sessions.filter((s) => s.refreshToken !== value);
    }
  }

  const res = Response.json({ ok: true });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  return res;
}
