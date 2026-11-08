import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { structuredModel, visitReadingBudget, visitReadingLimiter } from "@/server/model";
import { previewVisits } from "@/server/visit-preview";

const MAX_PREVIEW_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_PREVIEW_BYTES, label: "visit_preview" }, ({ viewer, circle }, input) =>
    previewVisits({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, model: structuredModel(), limiter: visitReadingLimiter, budget: visitReadingBudget }, input),
  );
}
