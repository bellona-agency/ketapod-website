import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/mock/session";

/**
 * Optimistic guard for the authenticated surface.
 *
 * Note the word optimistic. The Next docs are explicit that this layer "should
 * not be used as a full session management or authorization solution", and it
 * isn't one here: all it does is look for the presence of a cookie and bounce
 * visitors who plainly have none, so a logged-out person gets the login screen
 * instead of a flash of empty shelf. It never validates the token.
 *
 * The decision that matters is made in the route handlers, where `requireUser`
 * resolves the session against the store. A forged cookie gets past this file
 * and then gets a 401 from every endpoint that holds data.
 *
 * Named `proxy` rather than `middleware`: the middleware convention is
 * deprecated in Next 16 and renamed, with the same semantics.
 */
/**
 * Paths behind a session.
 *
 * `/kids` itself stays public — it is the parent-facing landing page and one of
 * the site's indexable surfaces. Only `/kids/[childId]` is behind a session.
 *
 * `/gift/[code]` and `/join/[code]` are absent for the same reason and it is a
 * deliberate one: both are links sent to people who do not have an account yet,
 * and bouncing them to a login screen before they can see what they were sent
 * is how a gift link stops converting. Claiming needs a session; looking does
 * not.
 *
 * This used to be the `config.matcher`. It moved into code because the preview
 * gate below has to see *every* request, so the matcher had to widen and the
 * per-path decision could no longer be expressed there.
 */
const PRIVATE_PREFIXES = [
  "/library",
  "/wallet",
  "/player",
  "/parent",
  "/progress",
  "/account",
  "/pay",
];

const isPrivate = (path: string) =>
  PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ||
  /^\/kids\/.+/.test(path);

/**
 * A single password in front of the whole site, for preview deployments.
 *
 * This exists because of one line in `api/v1/auth/otp/request`: the mock hands
 * the six-digit code back in its own response, and the login screen prints it.
 * That is right for a demo and catastrophic on a public address — anyone who
 * loads the page can type any phone number, read the code off the screen, and
 * be inside that account. Until a real SMS gateway is wired, the only safe way
 * to put this build on a public IP is to not let strangers reach it.
 *
 * Off unless `PREVIEW_PASSWORD` is set, so development and any future
 * production build are untouched. Deliberately not `NEXT_PUBLIC_`: that prefix
 * inlines the value into the client bundle, which would ship the password to
 * the very people it is meant to keep out.
 */
function previewGate(request: NextRequest) {
  const password = process.env.PREVIEW_PASSWORD;
  if (!password) return null;

  const user = process.env.PREVIEW_USER || "ketapod";
  const header = request.headers.get("authorization") ?? "";

  if (header.startsWith("Basic ")) {
    /* `atob` rather than Buffer: this runs on the edge runtime. Malformed
       base64 throws, and a malformed header is a failed attempt, not a 500. */
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    const sep = decoded.indexOf(":");
    if (sep > 0 && safeEqual(decoded.slice(0, sep), user)) {
      if (safeEqual(decoded.slice(sep + 1), password)) return null;
    }
  }

  return new NextResponse("نسخه پیش‌نمایش — رمز لازم است.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Ketapod preview", charset="UTF-8"',
      /* A preview build must never end up in an index, and a 401 alone does not
         stop a crawler that was given the password. */
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** Compare without returning early on the first differing byte. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const denied = previewGate(request);
  if (denied) return denied;

  const path = request.nextUrl.pathname;
  if (!isPrivate(path) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", path);
  return NextResponse.redirect(login);
}

export const config = {
  /* Everything except the build's own immutable assets. The gate has to see
     each request to be a gate at all; `_next/static` and `_next/image` are
     excluded because they are content-hashed, carry nothing private, and
     running middleware on every chunk is a cost paid on every page load. */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
