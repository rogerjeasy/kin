import { databases } from "@/server/database";
import { voiceConfirmResponse, voiceLinkDeps } from "@/server/presence-link";

/** A family member confirms their number from a text. Public by design: the link is the credential. */
export function POST(request: Request): Promise<Response> {
  return voiceConfirmResponse(request, voiceLinkDeps(() => databases().app));
}
