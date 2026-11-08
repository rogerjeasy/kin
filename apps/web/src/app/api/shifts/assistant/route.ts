import { ASSISTANT_LOCALE_HEADER } from "@/content/circle/shift-assistant-protocol";
import { circleJsonRoute } from "@/server/circle-json-route";
import { MAX_ASSISTANT_BYTES } from "@/server/shift-assistant-input";
import { assistantBudget, assistantLimiter, assistantModel, runShiftAssistant } from "@/server/shift-assistant";

export function POST(request: Request): Promise<Response> {
  const locale = request.headers.get(ASSISTANT_LOCALE_HEADER);
  // The widget's answer is read by the widget, not a page: nothing on the server's screens changes, so nothing is revalidated.
  return circleJsonRoute(request, { maxBytes: MAX_ASSISTANT_BYTES, label: "shift_assistant", revalidate: false }, ({ viewer, circle }, input) =>
    runShiftAssistant(
      { circle, userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, locale, model: assistantModel(), limiter: assistantLimiter, budget: assistantBudget },
      input,
    ),
  );
}
