import type { CallState } from "@kin/telephony";

/**
 * What the service remembers about a call it has answered, for two jobs the
 * sealed token cannot do. The token carries the conversation from turn to
 * turn and is the authority for it, so a restart in mid-call loses nothing.
 * But a caller who hangs up mid-question sends no more turns, only Twilio's
 * status report, which carries no token; and Twilio retries a request whose
 * answer was slow, which must not record a call twice. So the latest state of
 * each open call is kept here until the call is recorded or the time runs out.
 *
 * The cost of keeping it in memory: a restart forgets calls then in progress,
 * so one abandoned mid-question during a restart is not recorded, and a retry
 * straight after a restart could record a finished call twice. A call that
 * finishes is recorded in its last turn, before any hang-up, so a finished
 * call is never lost. The database holds nothing more because a call needs no
 * identity column to be recorded, and adding one is a schema change for a
 * window of seconds.
 */
export type OpenCall = { readonly state: CallState; readonly recorded: boolean; readonly expiresAt: number };

export type CallBook = {
  get(sid: string): OpenCall | undefined;
  set(sid: string, state: CallState, recorded: boolean): void;
};

const MAX_OPEN_CALLS = 10_000;

export function callBook(now: () => number, ttlMs: number): CallBook {
  const calls = new Map<string, OpenCall>();
  const purge = (): void => {
    const at = now();
    for (const [sid, call] of calls) if (call.expiresAt <= at) calls.delete(sid);
  };
  return {
    get(sid) {
      const call = calls.get(sid);
      return call !== undefined && call.expiresAt > now() ? call : undefined;
    },
    set(sid, state, recorded) {
      purge();
      // The oldest goes first: a flood of calls cannot grow the map without end.
      if (calls.size >= MAX_OPEN_CALLS && !calls.has(sid)) {
        const oldest = calls.keys().next().value;
        if (oldest !== undefined) calls.delete(oldest);
      }
      calls.delete(sid);
      calls.set(sid, { state, recorded, expiresAt: now() + ttlMs });
    },
  };
}
