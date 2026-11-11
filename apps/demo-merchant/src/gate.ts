import { MERCHANT_SIGNATURE_HEADER, verifyMerchantSignature } from "@kin/auth";

import { handle, type MerchantReply } from "./handler.ts";
import type { OrderBook } from "./orders.ts";

/** A request as it came off the socket, before anything about it is trusted. */
export type RawRequest = {
  readonly method: string;
  /** The request target exactly as sent: the path and any query. It is what the signature covers. */
  readonly target: string;
  readonly signature: string | null;
  readonly rawBody: string;
  /** Who is asking, for the rate limit: the first address App Runner's proxy names, or the socket's. */
  readonly client: string;
};

/** Counts requests per client in fixed windows. `take` says whether one more is allowed now. */
export type RateLimiter = { readonly take: (client: string) => boolean };

/** At most `limit` requests from one client in each window of `windowMs`; the oldest windows are forgotten. */
export function fixedWindowLimiter(options: { readonly limit: number; readonly windowMs: number; readonly now: () => Date }): RateLimiter {
  let window = -1;
  let counts = new Map<string, number>();
  return {
    take: (client) => {
      const current = Math.floor(options.now().getTime() / options.windowMs);
      if (current !== window) [window, counts] = [current, new Map()];
      const used = counts.get(client) ?? 0;
      if (used >= options.limit) return false;
      counts.set(client, used + 1);
      return true;
    },
  };
}

type GateDeps = { readonly book: OrderBook; readonly signingSecret: string; readonly limiter: RateLimiter; readonly now: () => Date };

/**
 * What stands in front of the pharmacy's routes. Only its health check is
 * open. Every other request is counted against its client's rate, then must
 * carry Kin's worker's signature over exactly this method, target and body,
 * made within the window, before its body is even parsed. A refusal says no
 * more than that it was refused.
 */
export function createGate(deps: GateDeps): (request: RawRequest) => Promise<MerchantReply> {
  return async (request) => {
    const path = new URL(request.target, "http://pharmacy.local").pathname;
    if (request.method === "GET" && path === "/health") return { status: 200, body: { ok: true } };
    if (!deps.limiter.take(request.client)) return { status: 429, body: { error: "too_many_requests" } };
    const verdict = verifyMerchantSignature({ secret: deps.signingSecret, header: request.signature, method: request.method, path: request.target, rawBody: request.rawBody, now: deps.now() });
    if (!verdict.ok) return { status: 401, body: { error: "unauthorized" } };
    let body: unknown = null;
    if (request.rawBody !== "") {
      try {
        body = JSON.parse(request.rawBody);
      } catch {
        return { status: 400, body: { error: "invalid_json" } };
      }
    }
    return handle(deps.book, { method: request.method, path, body });
  };
}

export { MERCHANT_SIGNATURE_HEADER };
