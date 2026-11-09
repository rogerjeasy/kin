import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { letterBudget, letterLimiter, structuredModel } from "@/server/model";
import { openPresence } from "@/server/presence";

const MAX_BYTES = 8_192;

/** The parent, or a member for them, asks Kin "is it really you?" about a call that said it was family. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "presence.open" }, ({ viewer, circle }, input) =>
    openPresence({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, origin: authConfig().webOrigin, model: structuredModel(), limiter: letterLimiter, budget: letterBudget }, input),
  );
}
