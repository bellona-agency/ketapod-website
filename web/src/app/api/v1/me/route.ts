import { cookies } from "next/headers";
import { balanceOf, db } from "@/lib/mock/db";
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

  return Response.json({
    id: user.id,
    phone: user.phone,
    name: user.name ?? null,
    roles: user.roles,
    createdAt: user.createdAt,
    walletBalanceRial: balanceOf(user.id),
    entitlementCount: live.length,
    deviceCount: db.devices.filter((d) => d.userId === user.id).length,
  });
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
