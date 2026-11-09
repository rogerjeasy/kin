import { quietSharesRoute } from "@/content/dashboard-routes";
import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { topUpServices } from "@/server/paypal";
import { runQuietShare } from "@/server/quiet-shares";

const MAX_QUIET_SHARE_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_QUIET_SHARE_BYTES, label: "quiet-share" }, ({ viewer, circle }, input) =>
    runQuietShare({ db: databases().app, userId: viewer.userId, circle }, { pool: topUpServices()?.pool ?? null, returnUrl: `${authConfig().webOrigin}${quietSharesRoute}` }, input),
  );
}
