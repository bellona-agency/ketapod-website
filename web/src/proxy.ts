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
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  /* `/kids` itself stays public — it is the parent-facing landing page and one
     of the site's indexable surfaces. Only `/kids/[childId]` is behind a
     session, which the nested matcher expresses. */
  matcher: [
    "/library/:path*",
    "/wallet/:path*",
    "/player/:path*",
    "/parent/:path*",
    "/kids/:childId+",
  ],
};
