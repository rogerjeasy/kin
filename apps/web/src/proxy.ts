import { readDemoSession } from "@kin/auth";
import { NextResponse, type NextRequest } from "next/server";

import { routeLocale } from "./i18n/routing";
import { sessionVerifier } from "./server/auth/config";
import { COOKIES } from "./server/auth/cookies";
import { DEMO_COOKIE } from "./server/auth/demo-cookie";
import { demoConfig } from "./server/demo-config";
import { isDashboardPage } from "./server/auth/next-path";

const PERMANENT_REDIRECT = 308;
const SEE_OTHER = 303;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isDashboardPage(pathname) && !hasDemoSession(request) && !(await hasSession(request))) {
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

// A visitor who pressed the Demo button carries a signed demo session instead.
function hasDemoSession(request: NextRequest): boolean {
  const demo = demoConfig();
  if (!demo.enabled) return false;
  return readDemoSession(demo.sessionKey, request.cookies.get(DEMO_COOKIE)?.value, new Date()) !== null;
}

export const config = {
  // Pages only. Skip Next's own files, the sign-in routes under /auth, the
  // site icon and anything with a file extension. API and webhook routes must
  // be excluded here when they are added, or they would be rewritten under a
  // language.
  matcher: ["/((?!_next/|auth/|icon$|.*\\..*).*)"],
};
