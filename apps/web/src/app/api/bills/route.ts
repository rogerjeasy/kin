import { runBillPayment } from "@/server/bill-payments";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";

const MAX_BILL_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BILL_BYTES, label: "bill_payment" }, ({ viewer, circle }, input) =>
    runBillPayment({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
