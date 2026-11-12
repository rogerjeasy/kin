import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { answerConsent, oauthClients } from "@/server/open-kin/oauth";

const MAX_BYTES = 8_192;

/** The member's answer on the consent screen, from Kin's own page: where the browser goes next, with a code or with access_denied. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "oauth.consent", revalidate: false }, ({ viewer, circle }, input) =>
    answerConsent({ db: databases().app, userId: viewer.userId, signedIn: viewer.kind === "person", circle, origin: authConfig().webOrigin, clients: oauthClients() }, input),
  );
}
