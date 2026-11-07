import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { readLetter } from "@/server/letters";
import { letterBudget, letterLimiter, structuredModel } from "@/server/model";

/** A photograph arrives as base64 inside JSON: the picture is capped at about 3 MB, so this leaves room for it. */
const MAX_LETTER_BYTES = 4_200_000;

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_LETTER_BYTES, label: "letters.read" }, ({ viewer, circle }, input) =>
    readLetter({ db: databases().app, userId: viewer.userId, circle, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, model: structuredModel(), limiter: letterLimiter, budget: letterBudget }, input),
  );
}
