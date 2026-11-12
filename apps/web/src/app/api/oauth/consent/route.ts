import { authConfig } from "@/server/auth/config";
import { clientKey } from "@/server/check-link";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { allowAuthorization, answerConsent, oauthClients } from "@/server/open-kin/oauth";

const MAX_BYTES = 8_192;

/** The member's answer on the consent screen, from Kin's own page: where the browser goes next, with a code or with access_denied. */
export async function POST(request: Request): Promise<Response> {
  if (!allowAuthorization(request.headers)) return Response.json({ ok: false, reason: "too_many_codes" }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "600" } });
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "oauth.consent", revalidate: false }, ({ viewer, circle }, input) =>
    answerConsent({ db: databases().app, userId: viewer.userId, signedIn: viewer.kind === "person", circle, origin: authConfig().webOrigin, clients: oauthClients(), from: clientKey(request.headers) }, input),
  );
}
