import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk session handling for every page, plus two route rules: the studio and the editor need an
// account, and a signed-in visitor skips the sign-in pages. The API checks the session token itself.
export default clerkMiddleware(
  async (auth, req) => {
    const { pathname } = req.nextUrl;
    if (pathname.startsWith("/studio") || pathname.startsWith("/p/")) {
      await auth.protect();
    } else if (pathname === "/login" || pathname === "/signup") {
      const { userId } = await auth();
      if (userId) return NextResponse.redirect(new URL("/studio", req.url));
    }
  },
  { signInUrl: "/login", signUpUrl: "/signup" },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3)).*)",
    "/(api|trpc)(.*)",
    // Clerk's frontend API routes.
    "/__clerk/(.*)",
  ],
};
