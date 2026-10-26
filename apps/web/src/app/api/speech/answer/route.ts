import { MAX_RECORDING_BYTES } from "@kin/speech";

import { circleBytesRoute } from "@/server/circle-json-route";
import { answerByVoice } from "@/server/speech-actions";

import { speechContext } from "../context";

/** A spoken answer to a proposal, then its spoken confirmation. Demo circles only. */
export function POST(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const step = query.get("step");
  const decision = query.get("decision");
  return circleBytesRoute(request, { maxBytes: MAX_RECORDING_BYTES, label: "speech.answer" }, async (context, pcm) => {
    if (step !== "answer" && step !== "confirm") return { ok: false as const, reason: "invalid" as const };
    return answerByVoice(speechContext(context), {
      proposalId: query.get("proposal") ?? "",
      pcm,
      locale: query.get("locale") ?? "",
      step,
      decision: decision === "approve" || decision === "reject" ? decision : null,
    });
  });
}
