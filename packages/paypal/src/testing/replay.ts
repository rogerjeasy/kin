import { readFileSync } from "node:fs";

import { createPayPalClient, type Fetch } from "../client.ts";
import { paypalPool, type PayPalPool } from "../pool.ts";

/** One call Kin's adapter made to PayPal's sandbox, as `scripts/billing-sandbox-record.ts` wrote it. */
export type RecordedExchange = {
  readonly method: string;
  readonly path: string;
  readonly requestId: string | null;
  readonly request: unknown;
  readonly httpStatus: number;
  readonly body: unknown;
};

/** What the adapter sent in a replay, to compare with what it sent the sandbox. */
export type SentRequest = { readonly method: string; readonly path: string; readonly requestId: string | null; readonly body: unknown };

/** Reads a recorded fixture from `src/fixtures`. */
export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
}

/**
 * A pool whose PayPal answers each call with the next recorded exchange, and
 * refuses a call to any other method or path (the query string aside, since a
 * recorded search window is the time it ran). Keeps what the adapter sent.
 */
export function replayPool(exchanges: readonly RecordedExchange[]): { readonly pool: PayPalPool; readonly sent: SentRequest[] } {
  const queue = [...exchanges];
  const sent: SentRequest[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "token", expires_in: 32_400 });
    const method = init.method ?? "GET";
    const next = queue.shift();
    if (next === undefined || next.method !== method || next.path.split("?")[0] !== url.pathname) {
      throw new Error(`Unexpected call: ${method} ${url.pathname}, expected ${next === undefined ? "nothing" : `${next.method} ${next.path}`}`);
    }
    sent.push({ method, path: `${url.pathname}${url.search}`, requestId: new Headers(init.headers).get("PayPal-Request-Id"), body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null });
    return new Response(next.body === null ? null : JSON.stringify(next.body), { status: next.httpStatus });
  };
  const client = createPayPalClient({ apiUrl: "https://paypal.test", clientId: "id", clientSecret: "secret", fetch, now: () => new Date("2026-11-11T23:00:00Z"), sleep: async () => undefined, log: () => undefined });
  return { pool: paypalPool(client, "WH-ID"), sent };
}
