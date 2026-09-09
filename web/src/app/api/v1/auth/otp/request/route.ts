import { db } from "@/lib/mock/db";

/**
 * Start an OTP login.
 *
 * The spec's identity choice is OTP over SMS with no password and no email, so
 * this is the only way in. A real deployment hands the code to Kavenegar; the
 * mock returns it in the response body and says so in `delivery`, because a
 * demo that cannot be logged into is not a demo.
 *
 * The response is identical for a known and an unknown phone. Differing would
 * turn this endpoint into a way to test whether a number has an account.
 */

const CODE_TTL_MS = 2 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

const IRAN_MOBILE = /^09\d{9}$/;

export async function POST(req: Request) {
  const { phone } = (await req.json().catch(() => ({}))) as { phone?: string };

  /* Normalise before validating: users paste ۰۹۱۲…, +98…, and numbers with
     spaces, and all three are the same account. */
  const normalised = normalisePhone(phone ?? "");
  if (!IRAN_MOBILE.test(normalised)) {
    return Response.json(
      { error: "invalid_phone", message: "شماره موبایل معتبر نیست." },
      { status: 422 },
    );
  }

  const existing = db.otps.find((o) => o.phone === normalised);
  if (existing && existing.expiresAt - CODE_TTL_MS + RESEND_COOLDOWN_MS > Date.now()) {
    return Response.json(
      { error: "too_soon", message: "چند لحظه صبر کنید و دوباره تلاش کنید." },
      { status: 429 },
    );
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.otps = db.otps.filter((o) => o.phone !== normalised);
  db.otps.push({
    phone: normalised,
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });

  return Response.json({
    phone: normalised,
    expiresInSec: CODE_TTL_MS / 1000,
    /* The one place the mock is visibly not the real core. */
    delivery: "mock",
    code,
  });
}

/** Persian and Arabic-Indic digits, +98/0098 prefixes, and separators. */
export function normalisePhone(raw: string) {
  const digits = raw
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");

  if (digits.startsWith("0098")) return `0${digits.slice(4)}`;
  if (digits.startsWith("98") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith("9") && digits.length === 10) return `0${digits}`;
  return digits;
}
