import { attachReferral, makeReferralCode } from "@/lib/mock/commerce";
import { db, notify, uid, type User } from "@/lib/mock/db";
import { SESSION_COOKIE, issueSession } from "@/lib/mock/session";
import { normalisePhone } from "../request/route";

/**
 * Complete an OTP login, creating the account on first success.
 *
 * There is no separate sign-up. The spec's identity model is a phone number, so
 * a number that verifies and has no row simply gets one — which is also why the
 * request endpoint can answer identically for known and unknown numbers.
 *
 * The session cookie is `httpOnly`, so the token is never readable from
 * JavaScript. The token pair is *also* returned in the body: the browser will
 * use the cookie, and a native client hitting the same endpoint needs the
 * tokens themselves.
 */

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const { phone, code, referralCode } = (await req.json().catch(() => ({}))) as {
    phone?: string;
    code?: string;
    /* Carried through from `/join/[code]`. Ignored for an existing account —
       an invite rewards bringing someone new, not re-labelling someone who was
       already here. */
    referralCode?: string;
  };

  const normalised = normalisePhone(phone ?? "");
  const challenge = db.otps.find((o) => o.phone === normalised);

  if (!challenge || challenge.expiresAt < Date.now()) {
    db.otps = db.otps.filter((o) => o.phone !== normalised);
    return Response.json(
      { error: "code_expired", message: "کد منقضی شده. دوباره درخواست دهید." },
      { status: 410 },
    );
  }

  /* Attempts are counted on the challenge, not per request, so brute force
     costs a new SMS rather than being free. */
  challenge.attempts += 1;
  if (challenge.attempts > MAX_ATTEMPTS) {
    db.otps = db.otps.filter((o) => o.phone !== normalised);
    return Response.json(
      { error: "too_many_attempts", message: "تعداد تلاش زیاد بود. دوباره درخواست دهید." },
      { status: 429 },
    );
  }

  if ((code ?? "").trim() !== challenge.code) {
    return Response.json(
      {
        error: "code_invalid",
        message: "کد درست نیست.",
        remainingAttempts: MAX_ATTEMPTS - challenge.attempts,
      },
      { status: 401 },
    );
  }

  db.otps = db.otps.filter((o) => o.phone !== normalised);

  const existing = db.users.find((u) => u.phone === normalised);
  const isNewAccount = !existing;

  const user: User =
    existing ??
    (() => {
      const created: User = {
        id: `usr_${uid()}`,
        phone: normalised,
        createdAt: new Date().toISOString(),
        roles: ["listener"],
        referralCode: makeReferralCode(),
      };
      db.users.push(created);
      return created;
    })();

  if (isNewAccount) {
    if (referralCode) attachReferral(user.id, referralCode);
    notify(
      user.id,
      "system",
      "به کتاپاد خوش آمدید",
      "کتابخانه‌ی شما آماده است. اولین کتاب را انتخاب کنید.",
      "/books",
    );
  }

  const session = issueSession(user, req.headers.get("user-agent") ?? "web");

  const res = Response.json({
    user: { id: user.id, phone: user.phone, name: user.name, roles: user.roles },
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    /* Whether the row was created *just now*, not whether it lacks a name. The
       previous check called any nameless account new, so a returning listener
       who had never set a display name was sent through onboarding every time. */
    isNewAccount,
  });

  /* `lax` rather than `strict`: a link from an SMS or an email must arrive
     already logged in, and `strict` would drop the cookie on that first
     cross-site navigation. */
  res.headers.append(
    "set-cookie",
    [
      `${SESSION_COOKIE}=${session.refreshToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${30 * 86400}`,
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return res;
}
