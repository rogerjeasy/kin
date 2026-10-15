import { NextResponse, type NextRequest } from "next/server";

import { routeLocale } from "./i18n/routing";
import { sessionVerifier } from "./server/auth/config";
import { COOKIES } from "./server/auth/cookies";
import { isDashboardPage } from "./server/auth/next-path";

const PERMANENT_REDIRECT = 308;
const SEE_OTHER = 303;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isDashboardPage(pathname) && !(await hasSession(request))) {
    // The refresh path renews an expired session, or sends the person to sign in.
    const url = new URL("/auth/refresh", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url, SEE_OTHER);
  }

  const decision = routeLocale(pathname);
  if (decision.kind === "pass") {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = decision.pathname;
  return decision.kind === "rewrite"
    ? NextResponse.rewrite(url)
    : NextResponse.redirect(url, PERMANENT_REDIRECT);
}

// The first gate in front of a circle's screens. Each page checks again on
// the server before it reads anything (AGENTS.md section 6).
async function hasSession(request: NextRequest): Promise<boolean> {
  const accessToken = request.cookies.get(COOKIES.access)?.value;
  const idToken = request.cookies.get(COOKIES.id)?.value;
  if (!accessToken || !idToken) return false;
  return (await sessionVerifier().verify({ accessToken, idToken })) !== null;
}

export const config = {
  // Pages only. Skip Next's own files, the sign-in routes under /auth, the
  // site icon and anything with a file extension. API and webhook routes must
  // be excluded here when they are added, or they would be rewritten under a
  // language.
  matcher: ["/((?!_next/|auth/|icon$|.*\\..*).*)"],
};
