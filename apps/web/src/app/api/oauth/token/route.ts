import { authConfig } from "@/server/auth/config";
import { clientKey } from "@/server/check-link";
import { databases } from "@/server/database";
import { createRateLimiter } from "@/server/model";
import { OPEN_CORS, exchangeToken, oauthClients, oauthResponse } from "@/server/open-kin/oauth";
import { readCappedText } from "@/server/request-body";

const MAX_BYTES = 8_192;
/** A client trades a code a few times a day; sixty tries in ten minutes from one address is far beyond that. */
const tokenLimiter = createRateLimiter(60, 10 * 60_000, { whenFull: "forgetOldest" });

/** The token endpoint (OAuth 2.1 section 3.2): an authorization code and its PKCE verifier for a delegation token. */
export async function POST(request: Request): Promise<Response> {
  const now = Date.now();
  const from = clientKey(request.headers);
  if (!tokenLimiter.allows(from, now)) return oauthResponse({ status: 429, body: { error: "temporarily_unavailable", error_description: "Too many token requests. Try again in a few minutes." } });
  tokenLimiter.record(from, now);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthResponse({ status: 400, body: { error: "invalid_request", error_description: "Send the token request as application/x-www-form-urlencoded." } });
  }
  const text = await readCappedText(request, MAX_BYTES);
  if (text === null) return oauthResponse({ status: 413, body: { error: "invalid_request", error_description: "The request is too large." } });
  try {
    return oauthResponse(await exchangeToken({ db: databases().app, origin: authConfig().webOrigin, clients: oauthClients(), from }, new URLSearchParams(text), request.headers.get("authorization")));
  } catch (error) {
    // Nothing about the fault reaches the client, and nothing of the request reaches the log.
    console.error(JSON.stringify({ message: "oauth.token.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return oauthResponse({ status: 503, body: { error: "temporarily_unavailable", error_description: "Kin could not answer just now. Start the authorization again." } });
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: OPEN_CORS });
}
