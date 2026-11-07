import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { checkDemand } from "@/server/letters";
import { letterBudget, letterLimiter, structuredModel } from "@/server/model";

const MAX_CHECK_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_CHECK_BYTES, label: "letters.check" }, ({ viewer, circle }, input) =>
    checkDemand({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, model: structuredModel(), limiter: letterLimiter, budget: letterBudget }, input),
  );
}
