import { databases } from "@/server/database";
import { presenceAnswerResponse, presenceLinkDeps } from "@/server/presence-link";

/** The real person answers "is this you?" from a text. Public by design: the link is the credential. */
export function POST(request: Request): Promise<Response> {
  return presenceAnswerResponse(request, presenceLinkDeps(() => databases().app));
}
