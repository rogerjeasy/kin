import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { runRefill } from "@/server/refills";

const MAX_REFILL_BYTES = 1_024;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_REFILL_BYTES, label: "refills" }, ({ viewer, circle }, input) =>
    runRefill({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
