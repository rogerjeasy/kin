import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { checkFamilyCode } from "@/server/presence";

const MAX_BYTES = 2_048;

/** The parent says what a caller answered when asked for the weekly family code; Kin compares it and answers with a fixed sentence. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "presence.code" }, ({ viewer, circle }, input) =>
    checkFamilyCode({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, origin: authConfig().webOrigin }, input),
  );
}
