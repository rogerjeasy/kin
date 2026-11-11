import { authConfig } from "@/server/auth/config";
import { manageAuthenticator } from "@/server/auth/authenticator";
import { readCappedText } from "@/server/request-body";
import { currentViewer } from "@/server/viewer";

const MAX_BYTES = 256;

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/**
 * A signed-in person sets up their own authenticator app: `begin` returns
 * the secret once, `confirm` checks a code from the app and makes it their
 * second factor. From Kin's own pages only, so another site cannot start it.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== authConfig().webOrigin) return json({ ok: false, reason: "refused" }, 403);
  const viewer = await currentViewer();
  if (viewer === null) return json({ ok: false, reason: "sign_in_again" }, 401);
  const text = await readCappedText(request, MAX_BYTES);
  if (text === null) return json({ ok: false, reason: "invalid" }, 413);
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  const result = await manageAuthenticator(viewer, input);
  if (result.ok) return json(result);
  const status = result.reason === "unavailable" ? 503 : result.reason === "too_many_tries" ? 429 : result.reason === "refused" ? 403 : result.reason === "sign_in_again" ? 401 : 400;
  return json(result, status);
}
