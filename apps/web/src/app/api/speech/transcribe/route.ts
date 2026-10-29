import { MAX_RECORDING_BYTES } from "@kin/speech";

import { circleBytesRoute } from "@/server/circle-json-route";
import { transcribe } from "@/server/speech-actions";

import { speechContext } from "../context";

/** A recording of up to a minute, as 16 kHz PCM, turned into words. */
export function POST(request: Request): Promise<Response> {
  const locale = new URL(request.url).searchParams.get("locale") ?? "";
  return circleBytesRoute(request, { maxBytes: MAX_RECORDING_BYTES, label: "speech.transcribe" }, (context, pcm) => transcribe(speechContext(context), { pcm, locale }));
}
