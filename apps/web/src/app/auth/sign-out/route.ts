import { logoutUrl } from "@kin/auth";
import type { NextRequest } from "next/server";

import { authConfig } from "@/server/auth/config";
import { clearedSessionCookies } from "@/server/auth/cookies";
import { redirectWithCookies } from "@/server/auth/respond";

const FORBIDDEN = 403;

/**
 * Ends the session here and at the identity provider. POST only, and only
 * from Kin's own pages: a browser names the page a form came from in Origin,
 * so a form on another site cannot sign someone out.
 */
export function POST(request: NextRequest) {
  const config = authConfig();
  if (request.headers.get("origin") !== config.webOrigin) {
    return new Response(null, { status: FORBIDDEN });
  }
  return redirectWithCookies(logoutUrl(config), config.webOrigin, clearedSessionCookies());
}
