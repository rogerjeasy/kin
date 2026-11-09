import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { requestHelp } from "@/server/presence";

const MAX_BYTES = 2_048;

/** After "yes, it was me", puts help for that person to the family for approval. It can go only to the account they confirmed. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "presence.help" }, ({ viewer, circle }, input) =>
    requestHelp({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, origin: authConfig().webOrigin }, input),
  );
}
