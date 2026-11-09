import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { manageConnection } from "@/server/open-kin/connections";

const MAX_BYTES = 1_024;

/** A member grants their own assistant a delegation, revokes one, or in a demo circle starts the live console. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "connections" }, ({ viewer, circle }, input) => manageConnection({ db: databases().app, userId: viewer.userId, circle, origin: authConfig().webOrigin }, input));
}
