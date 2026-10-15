import { NextResponse } from "next/server";

import type { CookieToSet } from "./cookies";

const SEE_OTHER = 303;

/**
 * A redirect that sets or clears cookies. It is never cached: each one
 * carries something meant for one browser, once.
 */
export function redirectWithCookies(location: string, base: string, cookies: readonly CookieToSet[]): NextResponse {
  const response = NextResponse.redirect(new URL(location, base), SEE_OTHER);
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  response.headers.set("cache-control", "no-store");
  return response;
}
