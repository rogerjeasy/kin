/**
 * The money records' state machines, from docs/architecture.md section 7.4.
 * A transition that is not listed here cannot happen, so a record only ever
 * moves forward, however late or often an event arrives.
 */

type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

export const PROPOSAL_TRANSITIONS = {
  proposed: ["pending_approval"],
  pending_approval: ["approved", "rejected", "expired", "cancelled"],
  approved: ["executing"],
  executing: ["settled", "failed"],
  failed: ["executing", "cancelled"],
  settled: [],
  rejected: [],
  expired: [],
  cancelled: [],
} as const satisfies Transitions<string>;

export const BILL_TRANSITIONS = {
  // A caregiver's structured bill has nothing to extract: the family sends it
  // for approval or declines it as received.
  received: ["extracted", "ready", "rejected"],
  extracted: ["needs_review", "ready", "duplicate"],
  needs_review: ["ready", "rejected"],
  // A bill the family pays outside Kin is paid once a member's receipt for it is credited.
  ready: ["proposed", "paid"],
  proposed: ["paid", "ready"],
  paid: [],
  rejected: [],
  duplicate: [],
} as const satisfies Transitions<string>;

export const EXECUTION_TRANSITIONS = {
  created: ["submitted"],
  submitted: ["confirmed", "pending_at_paypal", "failed", "unknown"],
  pending_at_paypal: ["confirmed", "failed"],
  unknown: ["confirmed", "failed"],
  confirmed: [],
  failed: [],
} as const satisfies Transitions<string>;

export type ProposalState = keyof typeof PROPOSAL_TRANSITIONS;
export type BillState = keyof typeof BILL_TRANSITIONS;
export type ExecutionState = keyof typeof EXECUTION_TRANSITIONS;

export type StateMachine = "proposal" | "bill" | "execution";

/** A record was asked to make a move its diagram does not list. */
export class TransitionError extends Error {
  readonly retryable = false;
  readonly machine: StateMachine;
  readonly from: string;
  readonly to: string;

  constructor(machine: StateMachine, from: string, to: string) {
    super(`A ${machine} cannot move from ${from} to ${to}`);
    this.name = "TransitionError";
    this.machine = machine;
    this.from = from;
    this.to = to;
  }
}

function machine<S extends string>(name: StateMachine, table: Transitions<S>) {
  const allowed = (from: S, to: S): boolean => table[from].includes(to);
  return {
    allowed,
    /** Returns `to`, or throws a `TransitionError` if the move is not listed. */
    advance(from: S, to: S): S {
      if (!allowed(from, to)) throw new TransitionError(name, from, to);
      return to;
    },
    /** A final state: nothing can follow it. */
    isFinal: (state: S): boolean => table[state].length === 0,
  };
}

export const proposalMachine = machine<ProposalState>(
  "proposal",
  PROPOSAL_TRANSITIONS,
);
export const billMachine = machine<BillState>("bill", BILL_TRANSITIONS);
export const executionMachine = machine<ExecutionState>(
  "execution",
  EXECUTION_TRANSITIONS,
);
