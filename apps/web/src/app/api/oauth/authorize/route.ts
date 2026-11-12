import type { NextRequest } from "next/server";

import { authConfig } from "@/server/auth/config";
import { clientKey } from "@/server/check-link";
import { CONSENT_PAGE, allowAuthorization, checkAuthorization, oauthClients } from "@/server/open-kin/oauth";

// A code or an error on its way back to the client is never stored, and the client's address never learns Kin's pages.
const PRIVATE = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;

/**
 * The authorization endpoint (OAuth 2.1 section 4.1.1). A client Kin knows,
 * with a redirect URI it registered, goes on to the consent screen with the
 * very same query: signing in, if the person has not, leads back there. Any
 * other problem is told to the client at that redirect URI; an unknown
 * client or redirect URI is told only to the person, here.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!allowAuthorization(request.headers)) {
    return new Response("Too many authorization requests. Try again in a few minutes.\n", { status: 429, headers: { ...PRIVATE, "content-type": "text/plain; charset=utf-8", "retry-after": "600" } });
  }
  const origin = authConfig().webOrigin;
  const check = await checkAuthorization(request.nextUrl.searchParams, { origin, clients: oauthClients(), from: clientKey(request.headers) });
  if (check.kind === "refuse") {
    return new Response(`Kin cannot authorize this request. ${check.description}\n`, { status: 400, headers: { ...PRIVATE, "content-type": "text/plain; charset=utf-8" } });
  }
  const location = check.kind === "redirect" ? check.location : new URL(`${CONSENT_PAGE}${request.nextUrl.search}`, origin).href;
  return new Response(null, { status: 303, headers: { ...PRIVATE, location } });
}
