/**
 * Session issuing and verification for the mock core.
 *
 * The spec's auth row reads: OTP over SMS, no password, no email; a short-lived
 * access token and an opaque refresh token held in the database so it can be
 * revoked; a `devices` row per session so concurrent playback can be capped.
 * That shape is reproduced here, with one honest substitution — the access
 * token is a random opaque string rather than a signed JWT, because a mock has
 * no signing key worth pretending about. Everything that consumes it goes
 * through `userFromRequest`, so swapping in real verification is one function.
 */

import { cookies } from "next/headers";
import { db, uid, type User } from "./db";

/** Short, per the spec. The refresh token is what survives. */
const ACCESS_TTL_MS = 30 * 60 * 1000;
const REFRESH_TTL_DAYS = 30;

export const SESSION_COOKIE = "kp_session";

export function issueSession(user: User, deviceLabel: string) {
  const deviceId = `dev_${uid()}`;
  db.devices.push({
    id: deviceId,
    userId: user.id,
    label: deviceLabel,
    lastSeenAt: new Date().toISOString(),
  });

  const session = {
    refreshToken: `rt_${uid()}${uid()}`,
    accessToken: `at_${uid()}${uid()}`,
    userId: user.id,
    deviceId,
    accessExpiresAt: Date.now() + ACCESS_TTL_MS,
    createdAt: new Date().toISOString(),
  };
  db.sessions.push(session);
  return session;
}

/**
 * Resolve the caller.
 *
 * Reads the bearer token first and the cookie second, so the same handlers
 * serve both the browser (cookie, set httpOnly at login) and any client that
 * holds a token directly — which is what the Flutter app will do against the
 * real core.
 *
 * The access token is refreshed in place when it has expired but its session is
 * still valid. A real core would make the client call `/auth/refresh`; doing it
 * here keeps the mock from logging people out mid-demo while leaving the
 * token-pair shape intact.
 */
export async function userFromRequest(req: Request): Promise<User | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer || (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = db.sessions.find(
    (s) => s.accessToken === token || s.refreshToken === token,
  );
  if (!session) return null;

  const age = Date.now() - Date.parse(session.createdAt);
  if (age > REFRESH_TTL_DAYS * 86_400_000) return null;

  if (session.accessExpiresAt < Date.now()) {
    session.accessToken = `at_${uid()}${uid()}`;
    session.accessExpiresAt = Date.now() + ACCESS_TTL_MS;
  }

  const device = db.devices.find((d) => d.id === session.deviceId);
  if (device) device.lastSeenAt = new Date().toISOString();

  return db.users.find((u) => u.id === session.userId) ?? null;
}

/** `401` in the shape the rest of the API uses, so clients parse one error type. */
export const unauthorized = () =>
  Response.json({ error: "unauthorized" }, { status: 401 });

/**
 * Guard for handlers that require a session.
 *
 * Authorisation is done here rather than in `proxy.ts` on purpose: the Next
 * docs are explicit that proxy is for optimistic redirects and "should not be
 * used as a full session management or authorization solution". The proxy
 * bounces logged-out visitors to `/login` for the look of it; this is the check
 * that actually decides.
 */
export async function requireUser(req: Request) {
  const user = await userFromRequest(req);
  return user ? { user } : { response: unauthorized() };
}
