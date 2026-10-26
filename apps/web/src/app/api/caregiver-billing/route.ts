import { runCaregiverBilling } from "@/server/caregiver-billing";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";

const MAX_BILL_BYTES = 32_768;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BILL_BYTES, label: "caregiver_billing" }, ({ viewer, circle }, input) =>
    runCaregiverBilling({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes }, input),
  );
}
