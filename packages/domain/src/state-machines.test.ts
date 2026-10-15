import { describe, expect, it } from "vitest";

import {
  BILL_TRANSITIONS,
  EXECUTION_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  TransitionError,
  billMachine,
  executionMachine,
  proposalMachine,
} from "./state-machines.ts";
import { forAll } from "./testing/property.ts";

// The moves drawn in the diagrams of docs/architecture.md section 7.4, copied
// by hand. A transition is added to the diagram, this list and the code
// together (AGENTS.md section 5, invariant 6).
const DIAGRAMS = {
  Proposal: [
    "proposed -> pending_approval",
    "pending_approval -> approved",
    "pending_approval -> rejected",
    "pending_approval -> expired",
    "pending_approval -> cancelled",
    "approved -> executing",
    "executing -> settled",
    "executing -> failed",
    "failed -> executing",
    "failed -> cancelled",
  ],
  Bill: [
    "received -> extracted",
    "extracted -> needs_review",
    "extracted -> ready",
    "needs_review -> ready",
    "needs_review -> rejected",
    "extracted -> duplicate",
    "ready -> proposed",
    "proposed -> paid",
    "proposed -> ready",
  ],
  Execution: [
    "created -> submitted",
    "submitted -> confirmed",
    "submitted -> pending_at_paypal",
    "pending_at_paypal -> confirmed",
    "pending_at_paypal -> failed",
    "submitted -> failed",
    "submitted -> unknown",
    "unknown -> confirmed",
    "unknown -> failed",
  ],
} as const;

const machines = [
  { name: "Proposal", table: PROPOSAL_TRANSITIONS, machine: proposalMachine, start: "proposed" },
  { name: "Bill", table: BILL_TRANSITIONS, machine: billMachine, start: "received" },
  { name: "Execution", table: EXECUTION_TRANSITIONS, machine: executionMachine, start: "created" },
] as const;

type Table = Readonly<Record<string, readonly string[]>>;

/** Every move a table allows, as "from -> to". */
function edgesOf(table: Table): string[] {
  return Object.entries(table)
    .flatMap(([from, targets]) => targets.map((to) => `${from} -> ${to}`))
    .toSorted();
}

// Loose views of a machine, so one test can drive all three.
type AnyMachine = {
  allowed(from: string, to: string): boolean;
  advance(from: string, to: string): string;
  isFinal(state: string): boolean;
};
const loose = (machine: unknown) => machine as AnyMachine;

describe.each(machines)("the $name state machine", ({ name, table, machine, start }) => {
  const states = Object.keys(table);
  const m = loose(machine);

  it("allows exactly the moves drawn in the architecture's diagram", () => {
    expect(edgesOf(table)).toEqual(DIAGRAMS[name].toSorted());
  });

  it("allows a move exactly when it is listed, and refuses every other", () => {
    for (const from of states) {
      for (const to of states) {
        const listed = (table as Table)[from]?.includes(to) ?? false;
        expect(m.allowed(from, to)).toBe(listed);
        if (listed) {
          expect(m.advance(from, to)).toBe(to);
        } else {
          expect(() => m.advance(from, to)).toThrow(TransitionError);
        }
      }
    }
  });

  it("names only its own states as targets", () => {
    for (const targets of Object.values(table as Table)) {
      for (const target of targets) expect(states).toContain(target);
    }
  });

  it("never lets a record stay where it is", () => {
    for (const state of states) expect(m.allowed(state, state)).toBe(false);
  });

  it("calls a state final exactly when nothing can follow it", () => {
    for (const state of states) {
      expect(m.isFinal(state)).toBe((table as Table)[state]?.length === 0);
    }
  });

  it("reaches every state from the start", () => {
    const seen = new Set<string>([start]);
    const queue: string[] = [start];
    for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
      for (const next of (table as Table)[state] ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].toSorted()).toEqual(states.toSorted());
  });

  it("ends every walk from the start in a final state", () => {
    forAll(
      (random) => {
        const path = [start as string];
        for (let step = 0; step < 50; step += 1) {
          const targets = (table as Table)[path.at(-1) ?? start] ?? [];
          const [first, ...rest] = targets;
          if (first === undefined) break;
          path.push(random.pick([first, ...rest]));
        }
        return path;
      },
      (path) => {
        for (let index = 1; index < path.length; index += 1) {
          expect(m.allowed(path[index - 1] ?? "", path[index] ?? "")).toBe(true);
        }
        // A proposal can retry after a failure, so a walk may loop; it must
        // still only ever pass through listed moves.
        if (name !== "Proposal") expect(m.isFinal(path.at(-1) ?? "")).toBe(true);
      },
    );
  });
});

describe("TransitionError", () => {
  it("names the machine and the refused move, and is not retryable", () => {
    let caught: unknown;
    try {
      proposalMachine.advance("settled", "executing");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TransitionError);
    expect(caught).toMatchObject({
      machine: "proposal",
      from: "settled",
      to: "executing",
      retryable: false,
      message: "A proposal cannot move from settled to executing",
    });
  });
});

describe("the moves money depends on", () => {
  it("never approves a proposal without asking for approval first", () => {
    expect(proposalMachine.allowed("proposed", "approved")).toBe(false);
    expect(proposalMachine.allowed("proposed", "executing")).toBe(false);
  });

  it("never moves an approved or settled proposal backwards", () => {
    expect(proposalMachine.allowed("approved", "pending_approval")).toBe(false);
    expect(proposalMachine.isFinal("settled")).toBe(true);
  });

  it("lets a failed proposal be retried or cancelled, and nothing else", () => {
    expect(PROPOSAL_TRANSITIONS.failed).toEqual(["executing", "cancelled"]);
  });

  it("never confirms an execution that was not submitted", () => {
    expect(executionMachine.allowed("created", "confirmed")).toBe(false);
  });

  it("settles an unknown execution only by what PayPal reports", () => {
    expect(EXECUTION_TRANSITIONS.unknown).toEqual(["confirmed", "failed"]);
    expect(executionMachine.isFinal("unknown")).toBe(false);
  });

  it("never pays a bill twice or reopens a paid bill", () => {
    expect(billMachine.isFinal("paid")).toBe(true);
    expect(billMachine.allowed("duplicate", "ready")).toBe(false);
  });
});
