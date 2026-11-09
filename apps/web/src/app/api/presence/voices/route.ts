import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { manageVoice } from "@/server/presence";

const MAX_BYTES = 2_048;

/** The organizer or the parent adds or removes a family member Kin may ask. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "presence.voices" }, ({ viewer, circle }, input) =>
    manageVoice({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, origin: authConfig().webOrigin }, input),
  );
}
