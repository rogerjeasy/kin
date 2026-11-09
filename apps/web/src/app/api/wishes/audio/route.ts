import { circleAudioRoute } from "@/server/circle-json-route";
import { wishAudio } from "@/server/wishes";

import { wishesContext } from "../context";

const MAX_AUDIO_REQUEST_BYTES = 1_024;

/** A wish aloud: her own recording, or her stored words read by Kin's voice. Never text sent in. */
export function POST(request: Request): Promise<Response> {
  return circleAudioRoute(request, { maxBytes: MAX_AUDIO_REQUEST_BYTES, label: "wishes.audio" }, (context, input) => wishAudio(wishesContext(context), input));
}
