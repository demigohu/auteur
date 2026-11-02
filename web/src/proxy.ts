import { type NextRequest, NextResponse } from "next/server";

// Optimistic check only: the API validates the session on every call and answers 401 when it is
// stale, which sends the browser back to /login (lib/api.ts). The cookie is the API's, but cookies
// ignore ports, so it is visible here on localhost and behind the shared domain in production.
const SESSION_COOKIE = "auteur_session";

export function proxy(request: NextRequest) {
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const { pathname, search } = request.nextUrl;
  if (!signedIn && (pathname.startsWith("/studio") || pathname.startsWith("/p/"))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (signedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/studio", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/studio/:path*", "/p/:path*", "/login", "/signup"],
};
