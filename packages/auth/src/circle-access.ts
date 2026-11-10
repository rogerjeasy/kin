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
  /** See the care calendar. A caregiver sees only their own shifts, which the database enforces again. */
  "shift.view": ["organizer", "contributor", "parent", "caregiver", "observer"],
  /** Put a shift, a visit, an appointment or a drive on the calendar. */
  "shift.schedule": ["organizer", "contributor", "parent"],
  /** Tap in and out of one's own shift. The database refuses anyone but the shift's own member. */
  "shift.check": ["caregiver", "organizer", "contributor", "parent"],
  /** Make a no-login check-in link for a shift, to text, print or show as a code. The database refuses anyone but the shift's own member and those who run the calendar. */
  "shift.link": ["caregiver", "organizer", "contributor", "parent"],
  /** Print the door tag: the card whose code opens a caregiver's own shifts, with nothing secret on it. */
  "shift.door": ["organizer", "parent"],
  /** Give the family's word that a visit happened: the parent, or a sibling where the parent cannot. Never the shift's own member. */
  "shift.confirm": ["organizer", "contributor", "parent"],
  /** Take a shift off the calendar: its own member, or whoever runs the calendar. */
  "shift.cancel": ["caregiver", "organizer", "contributor", "parent"],
  /** Record the parent's standing permission to pay confirmed shifts, or end it. The parent does so; in a demo circle the organizer plays her spoken yes. */
  "shift_permission.grant": ["organizer", "parent"],
  /** Hold a shift permission still without ending it: stopping is always safe. */
  "shift_permission.pause": ["organizer", "contributor", "parent"],
  /** Switch on Kin's call to the parent for the family's word, with her consent: the parent; in a demo circle the organizer plays her. */
  "shift_call.manage": ["organizer", "parent"],
  /** Switch that call off: stopping is always safe, so anyone who answers for the family may. */
  "shift_call.stop": ["organizer", "contributor", "parent"],
  /** Set the minimum visit and overtime rules a caregiver's shifts are priced by. */
  "shift_rules.manage": ["organizer"],
  /** Stop all approvals for 24 hours (section 15.3). An observer changes nothing. */
  "circle.pause": ["organizer", "contributor", "parent", "caregiver"],
  "member.invite": ["organizer"],
  /** Write a new version of the family agreement. Every member who shares the cost must then accept it. */
  "agreement.propose": ["organizer"],
  /** Accept the newest version: the members who share the cost, and the parent. */
  "agreement.accept": ["organizer", "contributor", "parent"],
  /** Read the written care agreements: whoever sees the money, and a caregiver for their own, which the database enforces again. */
  "care_agreement.view": ["organizer", "contributor", "parent", "caregiver", "observer"],
  /** Write a care agreement between the parent and a caregiver, as a draft to sign. */
  "care_agreement.propose": ["organizer"],
  /** Sign one: the caregiver, the parent for themselves, or the organizer for the parent. The database derives the capacity from the seat. */
  "care_agreement.sign": ["organizer", "parent", "caregiver"],
  /** Withdraw a draft that is not yet signed by both sides, or end one that is. */
  "care_agreement.manage": ["organizer"],
  /** Read the parent's wishes, her words and their recordings: the family. A caregiver may be paid under them and does not read them; the database enforces it again. */
  "wish.view": ["organizer", "contributor", "parent", "observer"],
  /** Say, confirm, change or withdraw a wish: the parent only, in her own seat, while no trigger is open. */
  "wish.record": ["parent"],
  /** Witness a wish she confirmed: the family members who share the cost, never the parent herself. */
  "wish.witness": ["organizer", "contributor"],
  /** See whether a trigger is reported or active, and who said so: everyone in the circle, the caregiver included, since she may attest one. */
  "wish_trigger.view": ["organizer", "contributor", "parent", "caregiver", "observer"],
  /** Say the parent went into hospital or a care home, or that she is home: the family, and the caregiver for a hospital admission, which the database decides. */
  "wish_trigger.attest": ["organizer", "contributor", "caregiver"],
  /** Say she is fine: the parent's own word dismisses a report or ends a trigger at once. Hers alone. */
  "wish_trigger.parent_fine": ["parent"],
  /** Take back a report nobody confirmed: the one who made it, or the organizer, which the database decides. */
  "wish_trigger.dismiss": ["organizer", "contributor", "caregiver"],
  /** Tell Kin about a subscription the parent pays, so a wish can name it. */
  "parent_subscription.manage": ["organizer"],
  "audit.view": ["organizer"],
  /** Have Kin keep the head of the record's hash chain when the record is checked or exported. An observer reads and never writes. */
  "audit_head.keep": ["organizer", "contributor", "parent"],
  "caregiver_rate.manage": ["organizer"],
  "caregiver_bill.submit": ["caregiver"],
  /** Say where one's own pay goes. Nobody else may, so nobody can redirect it. */
  "caregiver_receiver.set": ["caregiver"],
  /** Say which wallet, PayPal or Venmo, and which address one's own pay goes to. Nobody else may, so nobody can redirect it. */
  "payout_target.set": ["caregiver"],
  /** Hold up a letter, bill or receipt for Kin to read, and ask Kin to check a demand for money against the record. */
  "letter.read": ["organizer", "contributor", "parent"],
  "claim.check": ["organizer", "contributor", "parent"],
  /** Place a call to the family office line, or try it from the simulator, and have its verdict recorded and the family told. */
  "office_line.try": ["organizer", "contributor", "parent"],
  /** Ask Kin "is it really you?": tell it what a caller who said they were family asked for, so the real person is asked. */
  "presence.check": ["organizer", "contributor", "parent"],
  /** Add or remove the family members Kin may ask. The organizer and the parent: it is their family's list. */
  "presence.manage": ["organizer", "parent"],
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
  /** See the costs the family covers with quiet shares: what each costs, where it stands and the family's total. Never anyone's limit. */
  "quiet_share.view": ["organizer", "contributor", "parent", "observer"],
  /** Ask the family to cover a cost with quiet shares, spread a short one over months, or withdraw it. */
  "quiet_share.raise": ["organizer"],
  /** Talk privately to one's own Kin agent, seal one's own offer, take the gap on with Pay Later and say yes to one's own part: the members who share the cost. */
  "quiet_share.offer": ["organizer", "contributor"],
  /**
   * Connect one's own AI assistant to the circle under a delegation, or revoke it. Every member who may write anything may: a delegation's
   * scope only ever narrows the member's own role (authorizeDelegated), and the organizer may also revoke anyone's. An observer reads and never writes, so grants none.
   */
  "delegation.grant": ["organizer", "contributor", "parent", "caregiver"],
  /** Create or revoke the key a home-care agency's software reports visits with. A report is evidence and pays nothing. */
  "agency_key.manage": ["organizer"],
  /** The parent's Purse as the family sees it: its ceiling, balance and month's total, and any payment that raised a flag. Never a sealed item. */
  "purse.view": ["organizer", "contributor", "parent", "observer"],
  /** Spend from the Purse: ask Kin to send a payment, say yes or no to it, and share one with the family. Hers alone; nobody may spend it for her. */
  "purse.spend": ["parent"],
  /** Set up the Purse's weekly amount, ceiling and per-payment cap, or start it again after a pause: an approved family decision. */
  "purse.setup": ["organizer"],
  /** Hold the Purse still: stopping is always safe, so anyone who answers for the family may, and the parent herself. */
  "purse.stop": ["organizer", "contributor", "parent"],
  /** Cancel a held payment during its cooling-off: the parent, or a member who answers for the family. Nobody else can make one. */
  "purse.cancel": ["organizer", "contributor", "parent"],
  /** Put someone in the Purse's address book, to be verified once by the family. */
  "purse_payee.add": ["organizer", "contributor", "parent"],
  /** Verify an address-book entry: a member who answers for the family and did not add it. */
  "purse_payee.verify": ["organizer", "contributor"],
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
