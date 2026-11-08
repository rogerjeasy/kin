import { checkLinkDeps, checkLinkResponse } from "@/server/check-link";
import { databases } from "@/server/database";

/** A caregiver taps a check-in link. Public by design: the link is the credential. */
export function POST(request: Request): Promise<Response> {
  return checkLinkResponse(request, checkLinkDeps(() => databases().app));
}
