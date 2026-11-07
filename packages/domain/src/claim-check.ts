/**
 * The verdict on a demand for money, decided by plain code against what the
 * record holds (docs/architecture.md section 9.5). The model never decides
 * it: it may only put the result into words afterwards.
 */

/** A payee the circle knows, by name. */
export type KnownPayee = { readonly id: string; readonly name: string };

/** A bill the circle has received. */
export type KnownBill = { readonly payeeId: string; readonly cents: number; readonly state: string };

/** A payment PayPal confirmed, the fact a demand is checked against. */
export type KnownPayment = { readonly entryId: string; readonly payeeId: string; readonly cents: number; readonly day: string };

export type ClaimFacts = {
  /** Who the caller or letter said they were, as written. */
  readonly claimedPayee: string;
  /** What they demand, or `null` when no amount was named. */
  readonly claimedCents: number | null;
  readonly payees: readonly KnownPayee[];
  readonly bills: readonly KnownBill[];
  readonly payments: readonly KnownPayment[];
};

export type ClaimVerdict = "match" | "no_match" | "unclear";

/** Why the verdict is what it is. The words said to people are chosen from this, never invented. */
export type ClaimReason =
  /** The payee is known and holds an open bill of exactly this amount. */
  | "open_bill"
  /** The payee is known and this amount was already paid, with nothing open. */
  | "already_paid"
  /** Nobody the circle knows goes by that name. */
  | "unknown_payee"
  /** The payee is known, but the record holds no bill or payment of that amount. */
  | "amount_differs"
  /** The payee is known and no amount was named, so there is nothing to compare. */
  | "no_amount";

export type ClaimResult = {
  readonly verdict: ClaimVerdict;
  readonly reason: ClaimReason;
  readonly payeeId: string | null;
  /** The last payment the record holds to that payee, the fact checked against. */
  readonly lastPayment: KnownPayment | null;
};

/** Bills in these states are finished or never real: they cannot make a demand match. */
const CLOSED_BILL_STATES: readonly string[] = ["paid", "rejected", "duplicate"];

const NOISE_WORDS = new Set(["the", "of", "and", "inc", "llc", "ltd", "co", "corp", "company", "plc", "gmbh", "sa", "sas", "srl"]);

function tokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !NOISE_WORDS.has(word));
}

/**
 * Whether two names are the same payee: every word of the shorter is a word
 * of the longer ("Greenway Power" and "Greenway Power Co" agree; "Greenway"
 * alone does too). One short word never matches by accident: a single token
 * must be at least four letters.
 */
export function sameName(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length === 0) return false;
  if (shorter.length === 1 && (shorter[0]?.length ?? 0) < 4) return false;
  return shorter.every((word) => longer.includes(word));
}

/** Decides what a demand for money is, from the record alone. Pure: no clock, no network, no model. */
export function checkClaim(facts: ClaimFacts): ClaimResult {
  const payee = facts.payees.find((each) => sameName(each.name, facts.claimedPayee));
  if (!payee) return { verdict: "no_match", reason: "unknown_payee", payeeId: null, lastPayment: null };

  const payments = facts.payments.filter((each) => each.payeeId === payee.id).toSorted((a, b) => b.day.localeCompare(a.day));
  const lastPayment = payments[0] ?? null;
  const result = (verdict: ClaimVerdict, reason: ClaimReason): ClaimResult => ({ verdict, reason, payeeId: payee.id, lastPayment });

  if (facts.claimedCents === null) return result("unclear", "no_amount");
  const open = facts.bills.some((bill) => bill.payeeId === payee.id && bill.cents === facts.claimedCents && !CLOSED_BILL_STATES.includes(bill.state));
  if (open) return result("match", "open_bill");
  // Asking again for money the record shows as paid is the classic false demand.
  if (payments.some((each) => each.cents === facts.claimedCents)) return result("no_match", "already_paid");
  return result("unclear", "amount_differs");
}
