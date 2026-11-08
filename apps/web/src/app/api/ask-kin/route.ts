import { runAskKin } from "@/server/ask-kin/ask-kin";
import { paypalReader } from "@/server/ask-kin/world";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { askKinBudget, askKinLimiter, toolModel } from "@/server/model";
import { topUpServices, type TopUpServices } from "@/server/paypal";

/** A question, its language and six earlier turns fit in this, with room to spare. */
const MAX_ASK_BYTES = 16_384;

const paypalOf = (services: TopUpServices | null) => (services === null ? null : paypalReader(services.pool));

export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_ASK_BYTES, label: "ask_kin" }, ({ viewer, circle }, input) =>
    runAskKin(
      {
        db: databases().app,
        userId: viewer.userId,
        circle,
        accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes,
        model: toolModel(),
        paypal: paypalOf(topUpServices()),
        limiter: askKinLimiter,
        budget: askKinBudget,
      },
      input,
    ),
  );
}
