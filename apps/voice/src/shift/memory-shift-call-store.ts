import { ShiftCallError, type CallReport, type FamilyWordByCall, type ShiftCallWebhookRecord } from "@kin/db";
import { shiftCallIsActive, type ShiftCallState } from "@kin/domain";

import type { ShiftCallStore } from "./shift-call-store.ts";

/** One attempt of a shift's call, as the database holds it, with the names the call speaks. */
export type MemoryShiftCall = {
  readonly circleId: string;
  readonly shiftId: string;
  readonly attempt: number;
  readonly callSid: string | null;
  readonly state: ShiftCallState;
  readonly caregiverName: string;
  readonly dayPart: ShiftCallWebhookRecord["dayPart"];
  readonly contactName: string | null;
};

/** What the service asked the store to write, in order: what the database would have recorded. */
export type MemoryWrite =
  | { readonly kind: "answered"; readonly callSid: string }
  | { readonly kind: "word"; readonly callSid: string; readonly answer: "yes" | "no"; readonly settleQueued: boolean }
  | { readonly kind: "ended"; readonly callSid: string; readonly status: Exclude<CallReport, "answered">; readonly error: string | null };

export type MemoryShiftCallStore = ShiftCallStore & {
  readonly writes: readonly MemoryWrite[];
  /** The attempt as it stands now. */
  attempt(circleId: string, shiftId: string, attempt: number): MemoryShiftCall | undefined;
};

/**
 * An in-memory stand-in for the database's shift-call operations, for the demo
 * script and the service's unit tests. It keeps the rules those tests lean on:
 * an attempt waiting for its ID takes the first webhook's, another call's ID
 * is refused, a word never changes once given and said again changes nothing,
 * and a call that is over takes nothing. It is not the database: the
 * integration tests prove the real one.
 */
export function memoryShiftCallStore(attempts: readonly MemoryShiftCall[]): MemoryShiftCallStore {
  const rows = attempts.map((row) => ({ ...row }));
  const writes: MemoryWrite[] = [];
  const find = (circleId: string, shiftId: string, callSid: string) => rows.find((row) => row.circleId === circleId && row.shiftId === shiftId && row.callSid === callSid);
  const required = (circleId: string, shiftId: string, callSid: string) => {
    const row = find(circleId, shiftId, callSid);
    if (row === undefined) throw new ShiftCallError("no_such_call");
    return row;
  };
  const settle = (row: (typeof rows)[number], state: ShiftCallState): void => {
    rows[rows.indexOf(row)] = { ...row, state };
  };
  return {
    writes,
    attempt: (circleId, shiftId, attempt) => rows.find((row) => row.circleId === circleId && row.shiftId === shiftId && row.attempt === attempt),
    open: ({ circleId, shiftId, attempt, callSid }) => {
      const row = rows.find((candidate) => candidate.circleId === circleId && candidate.shiftId === shiftId && candidate.attempt === attempt);
      if (row === undefined || (row.callSid !== null && row.callSid !== callSid)) return Promise.resolve(null);
      let current = row;
      if (row.callSid === null) {
        if (row.state !== "queued" || rows.some((other) => other.circleId === circleId && other.callSid === callSid)) return Promise.resolve(null);
        current = { ...row, callSid, state: "calling" };
        rows[rows.indexOf(row)] = current;
      }
      return Promise.resolve({ state: current.state, caregiverName: current.caregiverName, dayPart: current.dayPart, contactName: current.contactName });
    },
    markAnswered: ({ circleId, shiftId, callSid }) => {
      const row = required(circleId, shiftId, callSid);
      if (row.state === "calling") {
        settle(row, "answered");
        writes.push({ kind: "answered", callSid });
      }
      return Promise.resolve();
    },
    recordWord: ({ circleId, shiftId, callSid, answer }) => {
      const row = required(circleId, shiftId, callSid);
      const outcome = answer === "yes" ? "confirmed" : "declined";
      const again = row.state === outcome;
      if (!again && !(row.state === "calling" || row.state === "answered")) return Promise.reject(new ShiftCallError("call_over"));
      if (!again) {
        settle(row, outcome);
        writes.push({ kind: "word", callSid, answer, settleQueued: answer === "yes" });
      }
      const word: FamilyWordByCall = { outcome, recorded: !again, shiftState: answer === "yes" ? "confirmed" : "checked_out" };
      return Promise.resolve(word);
    },
    reportEnd: ({ circleId, shiftId, callSid, status, error }) => {
      const row = required(circleId, shiftId, callSid);
      if (shiftCallIsActive(row.state)) {
        settle(row, status);
        writes.push({ kind: "ended", callSid, status, error: error ?? null });
      }
      return Promise.resolve();
    },
  };
}
