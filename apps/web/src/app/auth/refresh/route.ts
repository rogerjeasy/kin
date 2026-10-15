import { AuthError, refreshTokens } from "@kin/auth";
import type { NextRequest } from "next/server";

import { authConfig, sessionVerifier } from "@/server/auth/config";
import { COOKIES, clearedSessionCookies, sessionCookies } from "@/server/auth/cookies";
import { safeNextPath, signInPath } from "@/server/auth/next-path";
import { redirectWithCookies } from "@/server/auth/respond";

/**
 * Renews a session whose short-lived tokens have run out, with the refresh
 * token that only this path receives. With no refresh token, or one the
 * provider refuses, the person signs in again.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const refreshToken = request.cookies.get(COOKIES.refresh)?.value;
  if (!refreshToken) {
    return redirectWithCookies(signInPath(next), config.webOrigin, clearedSessionCookies());
  }

  try {
    const tokens = await refreshTokens(config, refreshToken);
    const session = await sessionVerifier().verify(tokens);
    if (!session) {
      return redirectWithCookies(signInPath(next, "failed"), config.webOrigin, clearedSessionCookies());
    }
    return redirectWithCookies(next, config.webOrigin, sessionCookies(tokens));
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // A refused refresh token is finished. A provider that is down may come back.
    const cleared = error.retryable ? [] : clearedSessionCookies();
    return redirectWithCookies(signInPath(next, error.retryable ? "unavailable" : undefined), config.webOrigin, cleared);
  }
}
