import { MANDATE_STATUSES, type MandateStatus } from "./mandate.ts";
import { assertCents, sumCents } from "./money.ts";
import { isPaused } from "./pause.ts";
import { hasUnusualRoute, scamMarkers, type ScamMarker } from "./presence-check.ts";

/**
 * The parent's Purse: a small allowance of her own, spent by her word alone.
 * The family funds it with a standing funding mandate (a weekly amount, topped
 * up only to a ceiling) and sets the most one payment may be without a
 * cooling-off. Whatever a fooled or coerced instruction asks, it can never cost
 * more than what is in the Purse, so nobody needs to watch each item.
 *
 * Everything here is plain code: the model reads her words into a payee, an
 * amount and a memo, and these rules decide whether the payment goes, waits or
 * is refused. The pressure markers can add a hold and never take one away.
 */

/** How long a held payment waits before it may go, with the family told at once. */
export const PURSE_HOLD_HOURS = 24;
/** How long Kin waits for her yes after reading a payment back. */
export const PURSE_CONFIRM_MINUTES = 15;
/** The longest memo kept with a payment: "for her birthday", "church collection". */
export const MAX_PURSE_MEMO_CHARS = 120;
/** The longest request Kin reads, spoken or typed. */
export const MAX_PURSE_WORDS_CHARS = 400;
/** The most people the family may put in her address book. */
export const MAX_PURSE_PAYEES = 24;

/** The funding mandate's status, the same three a refill mandate has. A revoked Purse is never funded again. */
export const PURSE_STATUSES = MANDATE_STATUSES;
export type PurseStatus = MandateStatus;

/** What the family set, in the circle's currency. */
export type PurseTerms = {
  /** What the pool moves into the Purse once a week, never past the ceiling. */
  readonly weeklyCents: number;
  /** The most the Purse ever holds: the worst case of any one instruction. */
  readonly ceilingCents: number;
  /** The most one payment may be without a cooling-off. */
  readonly perPaymentCents: number;
};

export type PurseTermsRefusal = "not_money" | "weekly_above_ceiling" | "cap_above_ceiling" | "above_agreement_ceiling";

/** The Purse's terms cannot be set. The same terms will be refused again. */
export class PurseTermsError extends Error {
  readonly retryable = false;
  readonly reason: PurseTermsRefusal;

  constructor(reason: PurseTermsRefusal) {
    super(`The Purse cannot be set up: ${reason}`);
    this.name = "PurseTermsError";
    this.reason = reason;
  }
}

/**
 * Whether the family may set these terms. Every amount is whole cents above
 * zero, a week's funding and a single payment each fit inside the ceiling,
 * and the ceiling never passes the agreement's own hard limit.
 */
export function checkPurseTerms(terms: PurseTerms, agreementCeilingCents: number): void {
  for (const value of [terms.weeklyCents, terms.ceilingCents, terms.perPaymentCents, agreementCeilingCents]) assertCents(value);
  if (terms.weeklyCents <= 0 || terms.ceilingCents <= 0 || terms.perPaymentCents <= 0) throw new PurseTermsError("not_money");
  if (terms.weeklyCents > terms.ceilingCents) throw new PurseTermsError("weekly_above_ceiling");
  if (terms.perPaymentCents > terms.ceilingCents) throw new PurseTermsError("cap_above_ceiling");
  if (terms.ceilingCents > agreementCeilingCents) throw new PurseTermsError("above_agreement_ceiling");
}

// ---------------------------------------------------------------------------
// The float
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday of the week a calendar day (YYYY-MM-DD, the circle's own) falls in. A week is funded once. */
export function purseWeekOf(day: string): string {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new RangeError(`Not a calendar day: ${day}`);
  const date = new Date(`${day}T00:00:00Z`);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export type PurseFunding = {
  readonly terms: PurseTerms;
  readonly status: PurseStatus;
  /** What the Purse holds now, by the ledger. */
  readonly balanceCents: number;
  /** The pool's money that has arrived and is promised to nobody: what the float may be drawn from. */
  readonly poolAvailableCents: number;
  /** Whether this week's float has been moved already. */
  readonly fundedThisWeek: boolean;
  /** False while the circle is paused or anything else holds outgoing money. */
  readonly spendingAllowed: boolean;
};

/**
 * How much the pool moves into the Purse now: the weekly amount, but never past
 * the ceiling, never more than the pool has free (AGENTS.md section 5, rule 8),
 * and never twice in a week. Unspent money therefore never piles up.
 */
export function purseTopUpCents(funding: PurseFunding): number {
  const { terms, balanceCents, poolAvailableCents } = funding;
  for (const value of [terms.weeklyCents, terms.ceilingCents, balanceCents, poolAvailableCents]) assertCents(value);
  if (funding.status !== "active" || funding.fundedThisWeek || !funding.spendingAllowed) return 0;
  return Math.max(0, Math.min(terms.weeklyCents, terms.ceilingCents - balanceCents, poolAvailableCents));
}

/**
 * What she may still spend: the balance less every payment she already said
 * yes to that has not left yet (approved, held, or on its way). Never below zero.
 */
export function purseAvailableCents(balanceCents: number, reservedCents: readonly number[]): number {
  assertCents(balanceCents);
  return Math.max(0, balanceCents - sumCents(reservedCents));
}

/**
 * Whether the Purse may be spent at all right now. The circle's pause switch
 * and a held "is it really you?" check both stop it, and so does any other
 * hold passed in as `heldUntil` (the latest instant anything holds outgoing
 * money). One function, so every new reason to stop spending joins here.
 */
export function purseSpendingAllowed(input: { readonly status: PurseStatus; readonly pausedUntil: Date | null; readonly heldUntil?: Date | null; readonly now: Date }): boolean {
  if (input.status !== "active") return false;
  return !isPaused(input.pausedUntil, input.now) && !isPaused(input.heldUntil ?? null, input.now);
}

// ---------------------------------------------------------------------------
// Deciding a payment
// ---------------------------------------------------------------------------

/**
 * Why a payment waits. `new_payee`: not in the address book the family
 * verified. `risky_route`: gift cards, crypto, a wire or a courier, ways no
 * grandchild needs to be paid. `above_cap`: more than one payment may be.
 * `pressure`: her words carry the signs of someone pressing her (secrecy,
 * urgency, a payment-app handle).
 */
export const PURSE_HOLD_REASONS = ["new_payee", "risky_route", "above_cap", "pressure"] as const;
export type PurseHoldReason = (typeof PURSE_HOLD_REASONS)[number];

/** Why a payment cannot be made at all. Asking again the same way gives the same answer. */
export const PURSE_REFUSALS = ["not_active", "paused", "not_money", "over_balance"] as const;
export type PurseRefusal = (typeof PURSE_REFUSALS)[number];

/** How the model read the way she wants to pay. It can raise a hold, never lower one. */
export const PURSE_ROUTES = ["paypal", "gift_card", "crypto", "wire", "cash", "unknown"] as const;
export type PurseRoute = (typeof PURSE_ROUTES)[number];

const RISKY_ROUTES: readonly PurseRoute[] = ["gift_card", "crypto", "wire", "cash"];
const PRESSURE_MARKERS: readonly ScamMarker[] = ["secrecy", "urgency", "payment_app"];

export type PurseRequest = {
  readonly cents: number;
  /** Whether the payee is a person or shop in the address book the family verified. */
  readonly payeeVerified: boolean;
  /** Everything she said about the payment: her words, the payee's name and the memo. Data, read by rules. */
  readonly words: readonly string[];
  /** The model's reading of how she wants to pay, or `null` without one. */
  readonly route: PurseRoute | null;
};

export type PurseSituation = {
  readonly terms: PurseTerms;
  readonly status: PurseStatus;
  readonly availableCents: number;
  readonly spendingAllowed: boolean;
};

export type PurseDecision =
  | { readonly outcome: "pay"; readonly markers: readonly ScamMarker[] }
  | { readonly outcome: "hold"; readonly reasons: readonly PurseHoldReason[]; readonly markers: readonly ScamMarker[] }
  | { readonly outcome: "refused"; readonly reason: PurseRefusal };

/** The signs of pressure and of an unusual way to pay in her words, by the same rules "is it really you?" uses. */
export function purseMarkers(words: readonly string[]): ScamMarker[] {
  return scamMarkers(words);
}

/** Every reason a payment must wait. Each test only adds: none takes a reason away. */
export function purseHoldReasons(situation: Pick<PurseSituation, "terms">, request: PurseRequest, markers: readonly ScamMarker[]): PurseHoldReason[] {
  const reasons = new Set<PurseHoldReason>();
  if (!request.payeeVerified) reasons.add("new_payee");
  if (hasUnusualRoute(markers) || (request.route !== null && RISKY_ROUTES.includes(request.route))) reasons.add("risky_route");
  if (request.cents > situation.terms.perPaymentCents) reasons.add("above_cap");
  if (markers.some((marker) => PRESSURE_MARKERS.includes(marker))) reasons.add("pressure");
  return PURSE_HOLD_REASONS.filter((reason) => reasons.has(reason));
}

/**
 * What happens to a payment she asked for, in this order:
 *   1. a Purse that is paused, revoked or held by the circle refuses it;
 *   2. an amount that is not whole cents above zero is refused;
 *   3. any hold reason holds it, even above the balance, so the family is told
 *      of a pressured request it could never pay (it lapses if it still
 *      cannot be paid when the hold ends);
 *   4. more than she may still spend is refused;
 *   5. anything else is paid on her yes alone.
 */
export function decidePursePayment(situation: PurseSituation, request: PurseRequest): PurseDecision {
  assertCents(situation.availableCents);
  if (situation.status !== "active") return { outcome: "refused", reason: "not_active" };
  if (!situation.spendingAllowed) return { outcome: "refused", reason: "paused" };
  if (!Number.isSafeInteger(request.cents) || request.cents <= 0) return { outcome: "refused", reason: "not_money" };
  const markers = purseMarkers(request.words);
  const reasons = purseHoldReasons(situation, request, markers);
  if (reasons.length > 0) return { outcome: "hold", reasons, markers };
  if (request.cents > situation.availableCents) return { outcome: "refused", reason: "over_balance" };
  return { outcome: "pay", markers };
}

/** When a payment held at `at` may go, if nobody objects. */
export function purseHoldEndsAt(at: Date): Date {
  return new Date(at.getTime() + PURSE_HOLD_HOURS * 60 * 60 * 1000);
}

export type HeldPayment = {
  readonly cents: number;
  readonly holdEndsAt: Date;
  /** Whether the payee is in the verified address book, with somewhere to pay. */
  readonly payeeVerified: boolean;
};

/**
 * What becomes of a held payment now. It never goes before its hold ends, and
 * a cancelled one has already left this state. When the hold ends it goes only
 * to a verified payee, only if the Purse may be spent and only if it fits what
 * is left; a new payee's request therefore never pays (the family adds the
 * person, and she asks again), and one that no longer fits lapses rather than
 * waiting for money to arrive.
 */
export function releaseHeldPayment(held: HeldPayment, purse: { readonly availableCents: number; readonly spendingAllowed: boolean }, now: Date): "wait" | "pay" | "lapse" {
  assertCents(held.cents);
  assertCents(purse.availableCents);
  if (now.getTime() < held.holdEndsAt.getTime()) return "wait";
  if (!purse.spendingAllowed) return "wait";
  if (!held.payeeVerified || held.cents > purse.availableCents) return "lapse";
  return "pay";
}

// ---------------------------------------------------------------------------
// A payment's states
// ---------------------------------------------------------------------------

/**
 * `proposed`: read back, waiting for her yes. `held`: she said yes and it waits
 * out its cooling-off, the family told. `approved`: her yes is the approval and
 * it is ready to go. `executing`: sent to PayPal. `unknown`: PayPal did not
 * answer, so Kin asks again and assumes nothing. `paid`: PayPal's record says
 * so (or, in a demo circle, it was simulated). `failed`: PayPal would not pay.
 * `declined`: she said no. `expired`: no yes in time, or a hold that lapsed.
 * `cancelled`: she or a family member stopped a held payment.
 */
export const PURSE_PAYMENT_TRANSITIONS = {
  proposed: ["approved", "held", "declined", "expired"],
  held: ["approved", "cancelled", "expired"],
  approved: ["executing"],
  executing: ["paid", "failed", "unknown"],
  unknown: ["paid", "failed"],
  paid: [],
  failed: [],
  declined: [],
  expired: [],
  cancelled: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type PursePaymentState = keyof typeof PURSE_PAYMENT_TRANSITIONS;
export const PURSE_PAYMENT_STATES = Object.keys(PURSE_PAYMENT_TRANSITIONS) as readonly PursePaymentState[];

export const pursePaymentMoveAllowed = (from: PursePaymentState, to: PursePaymentState): boolean => (PURSE_PAYMENT_TRANSITIONS[from] as readonly PursePaymentState[]).includes(to);

/** The states whose amount is still spoken for: the Purse cannot spend it twice. */
export const PURSE_RESERVED_STATES = ["held", "approved", "executing", "unknown"] as const satisfies readonly PursePaymentState[];

export const purseReserves = (state: PursePaymentState): boolean => (PURSE_RESERVED_STATES as readonly PursePaymentState[]).includes(state);

/**
 * What her payments already hold back from the Purse. A held payment to
 * someone not in her verified book holds nothing back: it can never be paid,
 * so a pressured request does not stop her spending while it waits to lapse.
 */
export function purseReservedCents(payments: readonly { readonly state: PursePaymentState; readonly cents: number; readonly payeeVerified: boolean }[]): number {
  return sumCents(payments.filter((payment) => purseReserves(payment.state) && (payment.state !== "held" || payment.payeeVerified)).map((payment) => payment.cents));
}

// ---------------------------------------------------------------------------
// What the family sees
// ---------------------------------------------------------------------------

/**
 * Whether the family may see one of her payments: only with her recorded
 * consent, or when it raised a flag (it was held). The database's row-level
 * security holds the same rule; this is the one the screens explain.
 */
export function familySeesPayment(payment: { readonly sharedAt: Date | null; readonly heldAt: Date | null }): boolean {
  return payment.sharedAt !== null || payment.heldAt !== null;
}
