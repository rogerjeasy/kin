import { authConfig } from "@/server/auth/config";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { textLimiter } from "@/server/shift-links";
import { runShift } from "@/server/shifts";
import { textSender } from "@/server/text-sender";

const MAX_SHIFT_BYTES = 4_096;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_SHIFT_BYTES, label: "shifts" }, ({ viewer, circle }, input) =>
    runShift({ db: databases().app, userId: viewer.userId, circle, links: { origin: authConfig().webOrigin, texts: textSender(), textLimiter, now: Date.now } }, input),
  );
}
