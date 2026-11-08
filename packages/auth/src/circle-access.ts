import type { CircleRole, MemberStatus } from "@kin/domain";

/**
 * What a member may do inside a circle, by role: the circle-role layer of
 * docs/architecture.md section 12.3. Every service asks `authorize`; none
 * writes its own role check. Row-level security enforces the same limits again
 * in the database.
 */
export const CIRCLE_ACTIONS = {
  /** See who is in the circle and what the circle is. */
  "circle.view": ["organizer", "contributor", "parent", "caregiver", "observer"],
  /** See the circle's money: the ledger, balances, fairness, settlement, agreement. */
  "money.view": ["organizer", "contributor", "parent", "observer"],
  /** See the bills and payments that pay oneself. */
  "own_payments.view": ["organizer", "contributor", "parent", "caregiver", "observer"],
  /** What Kin told the parent, and the scam checks it ran. */
  "safety.view": ["organizer", "contributor", "parent", "observer"],
  /**
   * Add money to the pool from one's own PayPal account. The members who
   * share the cost do; the parent's money is the pool's purpose, and a
   * caregiver or an observer has no share to pay.
   */
  "money.contribute": ["organizer", "contributor"],
  /** Say yes or no to a proposal (section 7.5: caregivers and observers never answer). */
  "proposal.answer": ["organizer", "contributor", "parent"],
  /** Ask Kin to propose a refill the family's rules allow. Proposing buys nothing: the agreement's yeses still do. */
  "refill.propose": ["organizer", "contributor", "parent"],
  /**
   * Record the parent's standing permission (a mandate), end it, or take it back up. The parent does so in
   * their own name; in a demo circle the organizer plays the parent's spoken yes, and the record says simulated.
   */
  "mandate.grant": ["organizer", "parent"],
  /** Hold a mandate still without ending it: anyone who answers for the family, since stopping is always safe. */
  "mandate.pause": ["organizer", "contributor", "parent"],
  /** Stop all approvals for 24 hours (section 15.3). An observer changes nothing. */
  "circle.pause": ["organizer", "contributor", "parent", "caregiver"],
  "member.invite": ["organizer"],
  /** Write a new version of the family agreement. Every member who shares the cost must then accept it. */
  "agreement.propose": ["organizer"],
  /** Accept the newest version: the members who share the cost, and the parent. */
  "agreement.accept": ["organizer", "contributor", "parent"],
  "audit.view": ["organizer"],
  /** Have Kin keep the head of the record's hash chain when the record is checked or exported. An observer reads and never writes. */
  "audit_head.keep": ["organizer", "contributor", "parent"],
  "caregiver_rate.manage": ["organizer"],
  "caregiver_bill.submit": ["caregiver"],
  /** Say where one's own pay goes. Nobody else may, so nobody can redirect it. */
  "caregiver_receiver.set": ["caregiver"],
  /** Hold up a letter, bill or receipt for Kin to read, and ask Kin to check a demand for money against the record. */
  "letter.read": ["organizer", "contributor", "parent"],
  "claim.check": ["organizer", "contributor", "parent"],
  /** Place a call to the family office line, or try it from the simulator, and have its verdict recorded and the family told. */
  "office_line.try": ["organizer", "contributor", "parent"],
  /** Send a caregiver's bill for the family's approval, or decline it: the members who share the cost. */
  "caregiver_bill.review": ["organizer", "contributor"],
  /** File a receipt for money spent from one's own pocket: the members who share the cost. */
  "receipt.submit": ["organizer", "contributor"],
  /** Approve or decline another member's receipt. The database refuses a member's decision on their own. */
  "receipt.decide": ["organizer", "contributor"],
  /** Put the month's settlement to the family for approval. */
  "settlement.propose": ["organizer"],
  /**
   * Ask a member who shares the cost for money by PayPal invoice: what the
   * settlement collects from them, or a top-up. Withdraw a request that waits.
   */
  "invoice.request": ["organizer"],
  /** Say where one's own settlement payout goes. Nobody else may, so nobody can redirect it. */
  "settlement_receiver.set": ["organizer", "contributor", "parent"],
} as const satisfies Record<string, readonly CircleRole[]>;

export type CircleAction = keyof typeof CIRCLE_ACTIONS;

/** A person's seat in one circle, as the members table records it. */
export type Seat = { readonly role: CircleRole; readonly status: MemberStatus };

export type AccessDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: "not_a_member" | "role" };

/** Whether `seat` may take `action`. No seat, or one not active, may take none. */
export function authorize(seat: Seat | null, action: CircleAction): AccessDecision {
  if (seat === null || seat.status !== "active") return { allowed: false, reason: "not_a_member" };
  const roles: readonly CircleRole[] = CIRCLE_ACTIONS[action];
  return roles.includes(seat.role) ? { allowed: true } : { allowed: false, reason: "role" };
}

/** Every action a seat may take, for screens that hide what is refused anyway. */
export function allowedActions(seat: Seat | null): CircleAction[] {
  return (Object.keys(CIRCLE_ACTIONS) as CircleAction[]).filter((action) => authorize(seat, action).allowed);
}

/** A refused action. Retrying cannot help: the person lacks the right. */
export class AccessDenied extends Error {
  readonly retryable = false;
  readonly action: CircleAction;
  readonly reason: "not_a_member" | "role";

  constructor(action: CircleAction, reason: "not_a_member" | "role") {
    super(`Not allowed: ${action} (${reason})`);
    this.name = "AccessDenied";
    this.action = action;
    this.reason = reason;
  }
}

/** Throws `AccessDenied` unless `seat` may take `action`. */
export function requireAccess(seat: Seat | null, action: CircleAction): void {
  const decision = authorize(seat, action);
  if (!decision.allowed) throw new AccessDenied(action, decision.reason);
}
