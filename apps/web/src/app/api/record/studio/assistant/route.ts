import { ASSISTANT_LOCALE_HEADER } from "@/content/circle/shift-assistant-protocol";
import { circleJsonRoute } from "@/server/circle-json-route";
import { assistantModel } from "@/server/shift-assistant";
import { MAX_STUDIO_BYTES, runStudioAssistant, studioBudget, studioLimiter } from "@/server/studio-assistant";

export function POST(request: Request): Promise<Response> {
  const locale = request.headers.get(ASSISTANT_LOCALE_HEADER);
  // The answer is read by AG Studio in the page; nothing on the server's screens changes, so nothing is revalidated.
  return circleJsonRoute(request, { maxBytes: MAX_STUDIO_BYTES, label: "studio_assistant", revalidate: false }, ({ viewer, circle }, input) =>
    runStudioAssistant(
      { circle, userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes, locale, model: assistantModel(), limiter: studioLimiter, budget: studioBudget },
      input,
    ),
  );
}
