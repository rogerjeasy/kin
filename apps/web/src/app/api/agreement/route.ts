import { runAgreement } from "@/server/agreement";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";

const MAX_AGREEMENT_BYTES = 16_384;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_AGREEMENT_BYTES, label: "agreement" }, ({ viewer, circle }, input) =>
    runAgreement({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
