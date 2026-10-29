import type { CircleSnapshot } from "@kin/db";
import { revalidatePath } from "next/cache";

import { authConfig } from "./auth/config";
import { circleOf } from "./circle";
import { readCappedText } from "./request-body";
import { currentViewer, type Viewer } from "./viewer";

export type CircleRequest = { readonly viewer: Viewer; readonly circle: CircleSnapshot };
export type CircleResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/**
 * One JSON request about the viewer's own circle: from Kin's own pages only,
 * from a verified viewer, with a capped body. Whatever `run` decides is
 * returned as is; a refusal is 403, any other problem 400, and a fault 503
 * with nothing about it but its name in the log.
 */
export async function circleJsonRoute<R extends CircleResult>(request: Request, options: { readonly maxBytes: number; readonly label: string }, run: (context: CircleRequest, input: unknown) => Promise<R>): Promise<Response> {
  if (request.headers.get("origin") !== authConfig().webOrigin) return json({ ok: false, reason: "refused" }, 403);
  const viewer = await currentViewer();
  if (viewer === null) return json({ ok: false, reason: "refused" }, 401);
  const circle = await circleOf(viewer);
  if (circle === null) return json({ ok: false, reason: "refused" }, 403);
  const text = await readCappedText(request, options.maxBytes);
  if (text === null) return json({ ok: false, reason: "invalid" }, 413);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }
  try {
    const result = await run({ viewer, circle }, input);
    if (result.ok) revalidatePath("/[locale]/dashboard", "layout");
    return json(result, result.ok ? 200 : result.reason === "refused" ? 403 : 400);
  } catch (error) {
    console.error(JSON.stringify({ message: `${options.label}.unavailable`, error: error instanceof Error ? error.name : "unknown" }));
    return json({ ok: false, reason: "unavailable" }, 503);
  }
}
