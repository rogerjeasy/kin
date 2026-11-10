import { MAX_RECORDING_BYTES } from "@kin/speech";

import { circleBytesRoute } from "@/server/circle-json-route";
import { keepRecording } from "@/server/wishes";

import { wishesContext } from "../context";

/** The parent's recording of a wish, as 16 kHz PCM: kept in her own voice, and written down when speech is on. */
export function POST(request: Request): Promise<Response> {
  const locale = new URL(request.url).searchParams.get("locale") ?? "";
  return circleBytesRoute(request, { maxBytes: MAX_RECORDING_BYTES, label: "wishes.recording" }, (context, pcm) => keepRecording(wishesContext(context), { pcm, locale }));
}
