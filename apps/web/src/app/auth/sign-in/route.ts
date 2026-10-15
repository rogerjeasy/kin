import { authorizeUrl, createSignInSecrets, parseAuthScreen } from "@kin/auth";
import type { NextRequest } from "next/server";

import { authConfig } from "@/server/auth/config";
import { signInCookie } from "@/server/auth/cookies";
import { localeOfPath, safeNextPath } from "@/server/auth/next-path";
import { redirectWithCookies } from "@/server/auth/respond";
import { encodeFlow } from "@/server/auth/sign-in-flow";

/**
 * Starts a sign-in: draws this attempt's secrets, keeps them in a short-lived
 * cookie, and sends the browser to the identity provider's sign-in page, or
 * its sign-up page when `screen=sign-up`.
 */
export function GET(request: NextRequest) {
  const config = authConfig();
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const screen = parseAuthScreen(searchParams.get("screen"));
  const secrets = createSignInSecrets();
  return redirectWithCookies(authorizeUrl(config, secrets, localeOfPath(next), screen), config.webOrigin, [signInCookie(encodeFlow({ ...secrets, next }))]);
}
