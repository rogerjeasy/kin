import { runCareAgreement } from "@/server/care-agreement";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";

const MAX_CARE_AGREEMENT_BYTES = 8_192;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_CARE_AGREEMENT_BYTES, label: "care-agreement" }, ({ viewer, circle }, input) =>
    runCareAgreement({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
