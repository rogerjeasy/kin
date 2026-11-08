import { describe, expect, it } from "vitest";

import { MAX_SHIFT_CALL_ATTEMPTS, SHIFT_CALL_STATES, SHIFT_CALL_TRANSITIONS, shiftCallIsActive, shiftCallMayMove } from "./shift-call.ts";

describe("Kin's call to the parent", () => {
  it("draws only moves that go forward, and every state it names", () => {
    for (const [from, tos] of Object.entries(SHIFT_CALL_TRANSITIONS)) {
      for (const to of tos) expect(SHIFT_CALL_STATES).toContain(to);
      expect(tos).not.toContain(from);
    }
    // No state can be reached again once left: the diagram has no cycle.
    const reachable = (from: string, seen = new Set<string>()): Set<string> => {
      for (const to of SHIFT_CALL_TRANSITIONS[from as keyof typeof SHIFT_CALL_TRANSITIONS]) {
        if (!seen.has(to)) reachable(to, seen.add(to));
      }
      return seen;
    };
    for (const state of SHIFT_CALL_STATES) expect(reachable(state).has(state)).toBe(false);
  });

  it("ends in a word, a no, or no word at all, and never moves again", () => {
    for (const end of ["confirmed", "declined", "no_answer", "failed"] as const) {
      expect(shiftCallIsActive(end)).toBe(false);
      for (const to of SHIFT_CALL_STATES) expect(shiftCallMayMove(end, to)).toBe(false);
    }
    expect(shiftCallMayMove("queued", "calling")).toBe(true);
    expect(shiftCallMayMove("queued", "answered")).toBe(false);
    expect(shiftCallMayMove("answered", "no_answer")).toBe(false);
    expect(["queued", "calling", "answered"].every((state) => shiftCallIsActive(state as "queued"))).toBe(true);
  });

  it("is tried twice at most", () => {
    expect(MAX_SHIFT_CALL_ATTEMPTS).toBe(2);
  });
});
