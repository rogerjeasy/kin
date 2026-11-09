import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { presenceStatus } from "@/server/presence";

const MAX_BYTES = 1_024;

/** How a check stands now. Read-only: the screen that waits on an answer asks every couple of seconds. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "presence.status", revalidate: false }, ({ viewer, circle }, input) =>
    presenceStatus({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, origin: authConfig().webOrigin }, input),
  );
}
