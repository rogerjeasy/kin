import type { CircleRequest } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { speechBudget, speechLimiter, speechServices } from "@/server/speech";
import type { SpeechContext } from "@/server/speech-actions";

/** What every speech route acts with: the viewer's circle, the speech services, and the limits. */
export function speechContext({ viewer, circle }: CircleRequest): SpeechContext {
  return {
    db: databases().app,
    userId: viewer.userId,
    circle,
    accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes,
    services: speechServices(),
    limiter: speechLimiter,
    budget: speechBudget,
  };
}
