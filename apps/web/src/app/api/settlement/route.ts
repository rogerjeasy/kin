import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { runSettlement } from "@/server/settlement";

const MAX_SETTLEMENT_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_SETTLEMENT_BYTES, label: "settlement" }, ({ viewer, circle }, input) =>
    runSettlement({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
