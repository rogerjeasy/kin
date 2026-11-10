import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { letterBudget, letterLimiter, structuredModel } from "@/server/model";
import { runPurse } from "@/server/purse-actions";

const MAX_BYTES = 4_096;

/** The parent's Purse: she asks, answers and shares; the family sets it up, keeps her address book and stops a held payment. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "purse" }, ({ viewer, circle }, input) =>
    runPurse({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, model: structuredModel(), limiter: letterLimiter, budget: letterBudget }, input),
  );
}
