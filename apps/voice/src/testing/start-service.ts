import { createServer as probeServer, type AddressInfo } from "node:net";

import { CALL_STATE_TTL_MS } from "@kin/telephony";

import { callBook } from "../call-book.ts";
import type { LineTarget } from "../config.ts";
import type { LineStore, VoiceLog } from "../office-line-service.ts";
import { voiceServer } from "../server.ts";

export const TEST_AUTH_TOKEN = "test-auth-token-0123456789abcdef";
export const TEST_STATE_KEY = "test-state-key-0123456789abcdef0123456789abcdef";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = probeServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export type RunningService = { readonly baseUrl: string; readonly now: { at: number }; close(): Promise<void> };

/**
 * Starts the phone service on a free local port. Twilio signs the address it
 * called, so the service is told the address it is reached at; `now` is a clock
 * the caller can move.
 */
export async function startService(options: { numbers: ReadonlyMap<string, LineTarget>; store: LineStore; log?: VoiceLog; authToken?: string; stateKey?: string }): Promise<RunningService> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const now = { at: Date.now() };
  const clock = (): number => now.at;
  const server = voiceServer({
    config: { numbers: options.numbers, authToken: options.authToken ?? TEST_AUTH_TOKEN, stateKey: options.stateKey ?? TEST_STATE_KEY, publicUrl: baseUrl },
    store: options.store,
    calls: callBook(clock, CALL_STATE_TTL_MS),
    now: clock,
    log: options.log ?? (() => undefined),
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { baseUrl, now, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
