import type { CircleSnapshot } from "@kin/db";

import { authConfig } from "./auth/config";
import { circleOf } from "./circle";
import { topUpServices, type TopUpServices } from "./paypal";
import { currentViewer, type Viewer } from "./viewer";

export type TopUpRequest = { readonly services: TopUpServices; readonly viewer: Viewer; readonly circle: CircleSnapshot };

/**
 * What every top-up route checks before anything else: the request comes from
 * one of Kin's own pages, top-ups are switched on, and the viewer is signed in
 * (or in the demo) with a circle. A response means stop and send it.
 */
export async function topUpRequest(request: Request): Promise<TopUpRequest | Response> {
  // A browser names the page a request came from; another site's page cannot pose as Kin's.
  if (request.method !== "GET" && request.headers.get("origin") !== authConfig().webOrigin) return status(403);
  const services = topUpServices();
  if (services === null) return status(404);
  const viewer = await currentViewer();
  if (viewer === null) return status(401);
  const circle = await circleOf(viewer);
  if (circle === null) return status(403);
  return { services, viewer, circle };
}

/** A JSON answer that no cache keeps. */
export function json(body: unknown, init: number = 200): Response {
  return Response.json(body, { status: init, headers: { "cache-control": "no-store" } });
}

function status(code: number): Response {
  return new Response(null, { status: code, headers: { "cache-control": "no-store" } });
}
