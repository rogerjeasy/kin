import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { placeOfficeCall } from "@/server/office-line";

const MAX_CALL_BYTES = 8_192;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_CALL_BYTES, label: "office-line.call" }, ({ viewer, circle }, input) =>
    placeOfficeCall({ db: databases().app, userId: viewer.userId, circle }, input),
  );
}
