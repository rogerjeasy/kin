import type { CircleRequest } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { createRateLimiter, structuredModel } from "@/server/model";
import { topUpServices } from "@/server/paypal";
import { speechServices } from "@/server/speech";
import type { WishesContext } from "@/server/wishes";

/** Each person may ask Kin to read back, record or play a wish forty times an hour; each server 400 times for demo visitors and as many for people. */
const wishLimiter = createRateLimiter(40, 60 * 60 * 1000);
const wishBudget = createRateLimiter(400, 60 * 60 * 1000);

/** What every wishes route acts with: the viewer's circle, the model and speech when this deployment has them, and the limits. */
export function wishesContext({ viewer, circle }: CircleRequest): WishesContext {
  return {
    db: databases().app,
    userId: viewer.userId,
    circle,
    accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes,
    model: structuredModel(),
    services: speechServices(),
    paypal: topUpServices()?.pool ?? null,
    limiter: wishLimiter,
    budget: wishBudget,
  };
}
