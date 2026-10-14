import { NextResponse, type NextRequest } from "next/server";

import { routeLocale } from "./i18n/routing";

const PERMANENT_REDIRECT = 308;

export function proxy(request: NextRequest): NextResponse {
  const decision = routeLocale(request.nextUrl.pathname);
  if (decision.kind === "pass") {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = decision.pathname;
  return decision.kind === "rewrite"
    ? NextResponse.rewrite(url)
    : NextResponse.redirect(url, PERMANENT_REDIRECT);
}

export const config = {
  // Pages only. Skip Next's own files and anything with a file extension.
  // API and webhook routes must be excluded here when they are added, or they
  // would be rewritten under a language.
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
