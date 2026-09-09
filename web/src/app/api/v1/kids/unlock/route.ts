import { db } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * Leaving kids mode.
 *
 * The spec makes exit a parent action guarded by a PIN: «کودک نباید بتواند خارج
 * شود». So the check is server-side. A PIN compared in the browser is readable
 * in the bundle and bypassable from the console, which for a lock whose entire
 * threat model is a curious seven-year-old with the device in their hands is
 * the one place it would actually fail.
 *
 * Throttled per session rather than per request: four digits is 10,000
 * possibilities, which a script exhausts in seconds and a child does not.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

const attempts = new Map<string, { count: number; until: number }>();

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const state = attempts.get(user.id);
  if (state && state.until > Date.now()) {
    return Response.json(
      {
        error: "locked_out",
        retryInSec: Math.ceil((state.until - Date.now()) / 1000),
      },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: string };
  const lock = db.kidsLocks.find((l) => l.userId === user.id);

  /* No PIN set means the account never entered kids mode deliberately; letting
     the exit through is right, since there is nothing to protect yet. */
  if (!lock) return Response.json({ ok: true });

  if ((body.pin ?? "").trim() !== lock.pin) {
    const count = (state?.count ?? 0) + 1;
    attempts.set(user.id, {
      count,
      until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    });
    return Response.json(
      { error: "wrong_pin", remaining: Math.max(0, MAX_ATTEMPTS - count) },
      { status: 403 },
    );
  }

  attempts.delete(user.id);
  return Response.json({ ok: true });
}
