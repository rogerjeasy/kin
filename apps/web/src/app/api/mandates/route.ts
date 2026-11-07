import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { runMandate } from "@/server/mandates";

const MAX_MANDATE_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_MANDATE_BYTES, label: "mandates" }, ({ viewer, circle }, input) =>
    runMandate({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
