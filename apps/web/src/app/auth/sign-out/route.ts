import { logoutUrl } from "@kin/auth";

import { authConfig } from "@/server/auth/config";
import { clearedSessionCookies } from "@/server/auth/cookies";
import { redirectWithCookies } from "@/server/auth/respond";

/**
 * Ends the session here and at the identity provider. POST only, so a link
 * or an image on another site cannot sign someone out.
 */
export function POST() {
  const config = authConfig();
  return redirectWithCookies(logoutUrl(config), config.webOrigin, clearedSessionCookies());
}
