import { clientKey } from "@/server/check-link";
import { createRateLimiter } from "@/server/model";
import { agencySigningKey } from "@/server/open-kin/agency";
import { OPEN_CORS, oauthResponse, registerClient } from "@/server/open-kin/oauth";
import { readCappedText } from "@/server/request-body";

const MAX_BYTES = 8_192;
/** Registering stores nothing, so these only bound the work: twenty an hour from one address, a thousand an hour in all. */
const registrationLimiter = createRateLimiter(20, 60 * 60_000, { whenFull: "forgetOldest" });
const registrationBudget = createRateLimiter(1_000, 60 * 60_000);

/** Dynamic client registration (RFC 7591) for public MCP clients. */
export async function POST(request: Request): Promise<Response> {
  const now = Date.now();
  const from = clientKey(request.headers);
  if (!registrationLimiter.allows(from, now) || !registrationBudget.allows("all", now)) {
    return oauthResponse({ status: 429, body: { error: "temporarily_unavailable", error_description: "Too many registrations. Try again later." } });
  }
  registrationLimiter.record(from, now);
  registrationBudget.record("all", now);
  const text = await readCappedText(request, MAX_BYTES);
  if (text === null) return oauthResponse({ status: 413, body: { error: "invalid_client_metadata", error_description: "The registration is too large." } });
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return oauthResponse({ status: 400, body: { error: "invalid_client_metadata", error_description: "Send the client metadata as a JSON object." } });
  }
  return oauthResponse(registerClient(agencySigningKey(), input, now));
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: OPEN_CORS });
}
