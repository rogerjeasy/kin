import type { CircleSnapshot } from "@kin/db";
import { revalidatePath } from "next/cache";

import { authConfig } from "./auth/config";
import { circleOf } from "./circle";
import { readCappedBytes, readCappedText } from "./request-body";
import { currentViewer, type Viewer } from "./viewer";

export type CircleRequest = { readonly viewer: Viewer; readonly circle: CircleSnapshot };
export type CircleResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/**
 * The viewer and their circle for a request from Kin's own pages, or the
 * response that refuses it. Every circle route starts here.
 */
async function circleRequest(request: Request): Promise<CircleRequest | Response> {
  if (request.headers.get("origin") !== authConfig().webOrigin) return json({ ok: false, reason: "refused" }, 403);
  const viewer = await currentViewer();
  if (viewer === null) return json({ ok: false, reason: "refused" }, 401);
  const circle = await circleOf(viewer);
  if (circle === null) return json({ ok: false, reason: "refused" }, 403);
  return { viewer, circle };
}

/** A refusal is 403, any other problem 400; success revalidates the circle's screens. */
function answer(result: CircleResult): Response {
  if (result.ok) revalidatePath("/[locale]/dashboard", "layout");
  return json(result, result.ok ? 200 : result.reason === "refused" ? 403 : 400);
}

function unavailable(label: string, error: unknown): Response {
  console.error(JSON.stringify({ message: `${label}.unavailable`, error: error instanceof Error ? error.name : "unknown" }));
  return json({ ok: false, reason: "unavailable" }, 503);
}

const NOT_JSON = Symbol("not JSON");

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const text = await readCappedText(request, maxBytes);
  if (text === null) return json({ ok: false, reason: "invalid" }, 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/**
 * One JSON request about the viewer's own circle: from Kin's own pages only,
 * from a verified viewer, with a capped body. Whatever `run` decides is
 * returned as is; a fault is 503 with nothing about it but its name in the log.
 */
export async function circleJsonRoute<R extends CircleResult>(request: Request, options: { readonly maxBytes: number; readonly label: string }, run: (context: CircleRequest, input: unknown) => Promise<R>): Promise<Response> {
  const context = await circleRequest(request);
  if (context instanceof Response) return context;
  const input = await readJson(request, options.maxBytes);
  if (input instanceof Response) return input;
  if (input === NOT_JSON) return json({ ok: false, reason: "invalid" }, 400);
  try {
    return answer(await run(context, input));
  } catch (error) {
    return unavailable(options.label, error);
  }
}

/** The same, for a request whose body is raw bytes, such as recorded audio. */
export async function circleBytesRoute<R extends CircleResult>(request: Request, options: { readonly maxBytes: number; readonly label: string }, run: (context: CircleRequest, body: Uint8Array) => Promise<R>): Promise<Response> {
  const context = await circleRequest(request);
  if (context instanceof Response) return context;
  const body = await readCappedBytes(request, options.maxBytes);
  if (body === null) return json({ ok: false, reason: "recording" }, 413);
  try {
    return answer(await run(context, body));
  } catch (error) {
    return unavailable(options.label, error);
  }
}

/** A JSON request answered, when it succeeds, with audio rather than JSON. */
export async function circleAudioRoute(
  request: Request,
  options: { readonly maxBytes: number; readonly label: string },
  run: (context: CircleRequest, input: unknown) => Promise<{ readonly ok: true; readonly audio: Uint8Array; readonly contentType: string } | { readonly ok: false; readonly reason: string }>,
): Promise<Response> {
  const context = await circleRequest(request);
  if (context instanceof Response) return context;
  const input = await readJson(request, options.maxBytes);
  if (input instanceof Response) return input;
  if (input === NOT_JSON) return json({ ok: false, reason: "invalid" }, 400);
  try {
    const result = await run(context, input);
    if (!result.ok) return answer(result);
    return new Response(Buffer.from(result.audio), { headers: { "content-type": result.contentType, "cache-control": "no-store" } });
  } catch (error) {
    return unavailable(options.label, error);
  }
}
