import { rosesMonth, type CircleRole, type ParentLevel, type ProposalKind } from "@kin/domain";

import type { ApprovalMethod, ClaimVerdict, DocumentKind } from "../values.ts";

/**
 * Rose's circle from docs/project-description.md section 5, as the rows a
 * real circle would hold on the evening of 30 October 2026. The ledger and the
 * agreement are the money core's own example (`rosesMonth`); everything here
 * sits around them. Every figure is simulated and labelled so. Each visitor's
 * copy is moved to the moment they press the Demo button (`demoTime`), so the
 * dates written here are the template's, not the ones a visitor sees.
 */

export const ROSES_CIRCLE = {
  name: "Rose's circle",
  timezone: "America/New_York",
  currency: rosesMonth.ledger.currency,
  /** The template's clock: Rose's month is ready to close. Every date here is written around it. */
  clockAt: new Date("2026-10-30T18:00:00Z"),
  period: rosesMonth.period,
  /** The seat a visitor takes: Elena, the organizer. */
  visitorSeat: "elena",
} as const;

export type PersonaKey = "rose" | "elena" | "marcus" | "ana" | "amara" | "daniel";

export type Persona = {
  readonly key: PersonaKey;
  readonly name: string;
  readonly role: CircleRole;
  readonly parentLevel: ParentLevel | null;
  readonly relationship: string | null;
  readonly joinedAt: Date;
};

export const PERSONAS: readonly Persona[] = [
  { key: "rose", name: "Rose", role: "parent", parentLevel: "decides", relationship: null, joinedAt: new Date("2026-09-01T14:00:00Z") },
  { key: "elena", name: "Elena", role: "organizer", parentLevel: null, relationship: "daughter", joinedAt: new Date("2026-09-01T14:00:00Z") },
  { key: "marcus", name: "Marcus", role: "contributor", parentLevel: null, relationship: "son", joinedAt: new Date("2026-09-02T18:30:00Z") },
  { key: "ana", name: "Ana", role: "contributor", parentLevel: null, relationship: "daughter", joinedAt: new Date("2026-09-02T20:15:00Z") },
  { key: "amara", name: "Amara", role: "caregiver", parentLevel: null, relationship: "caregiver", joinedAt: new Date("2026-09-05T15:00:00Z") },
  // The family's lawyer reads everything and changes nothing, so the demo shows every role.
  { key: "daniel", name: "Daniel", role: "observer", parentLevel: null, relationship: "family lawyer", joinedAt: new Date("2026-09-10T16:00:00Z") },
];

export type PayeeKey = "electricity" | "gas" | "water" | "pharmacy" | "amara" | "stairlift";

export type DemoPayee = {
  readonly key: PayeeKey;
  readonly name: string;
  readonly category: string;
  readonly status: "approved" | "new";
  readonly member: PersonaKey | null;
  readonly autoPay: { readonly ruleId: string; readonly minCents: number; readonly maxCents: number } | null;
};

/**
 * Who the circle pays, by the names on their bills, which read the same in
 * every language Kin speaks. The two utilities pay themselves inside the range the
 * family expects. The stairlift company is new, so every bill from it needs a
 * person and the whole circle is told.
 */
export const PAYEES: readonly DemoPayee[] = [
  { key: "electricity", name: "Northfield Electric", category: "utilities", status: "approved", member: null, autoPay: { ruleId: "standing-electricity", minCents: 7000, maxCents: 10000 } },
  { key: "gas", name: "Northfield Gas", category: "utilities", status: "approved", member: null, autoPay: { ruleId: "standing-gas", minCents: 4500, maxCents: 7000 } },
  { key: "water", name: "Lakeside Water", category: "utilities", status: "approved", member: null, autoPay: null },
  { key: "pharmacy", name: "Elm Street Pharmacy", category: "pharmacy", status: "approved", member: null, autoPay: null },
  { key: "amara", name: "Amara", category: "care", status: "approved", member: "amara", autoPay: null },
  { key: "stairlift", name: "Ridgeway Stairlifts", category: "repairs", status: "new", member: null, autoPay: null },
];

/** Everyone who accepted version 1 of the agreement, and how. */
export const ACCEPTANCES: readonly { member: PersonaKey; method: ApprovalMethod; at: Date }[] = [
  { member: "elena", method: "app", at: new Date("2026-09-03T19:00:00Z") },
  { member: "marcus", method: "app", at: new Date("2026-09-03T21:40:00Z") },
  { member: "ana", method: "app", at: new Date("2026-09-04T08:05:00Z") },
  { member: "rose", method: "voice", at: new Date("2026-09-04T15:30:00Z") },
];

export const AGREEMENT_EFFECTIVE_ON = "2026-10-01";

export type DemoDocument = { readonly key: string; readonly kind: DocumentKind; readonly uploadedBy: PersonaKey; readonly at: Date };

export const DOCUMENTS: readonly DemoDocument[] = [
  { key: "water-letter", kind: "letter", uploadedBy: "rose", at: new Date("2026-10-12T15:20:00Z") },
  { key: "stairlift-quote", kind: "quote", uploadedBy: "elena", at: new Date("2026-10-29T14:45:00Z") },
];

export type DemoBill = {
  readonly key: string;
  readonly payee: PayeeKey;
  readonly cents: number;
  readonly receivedOn: string;
  readonly dueOn: string | null;
  readonly state: "paid" | "proposed";
  readonly document: string | null;
};

/** The bills of October. The amounts paid match the ledger's entries. */
export const BILLS: readonly DemoBill[] = [
  { key: "gas", payee: "gas", cents: 5700, receivedOn: "2026-10-01", dueOn: "2026-10-02", state: "paid", document: null },
  { key: "electricity", payee: "electricity", cents: 8400, receivedOn: "2026-10-02", dueOn: "2026-10-03", state: "paid", document: null },
  { key: "amara-week-41", payee: "amara", cents: 26400, receivedOn: "2026-10-06", dueOn: "2026-10-06", state: "paid", document: null },
  { key: "water", payee: "water", cents: 6100, receivedOn: "2026-10-12", dueOn: "2026-10-30", state: "paid", document: "water-letter" },
  { key: "stairlift", payee: "stairlift", cents: 90000, receivedOn: "2026-10-29", dueOn: "2026-11-12", state: "proposed", document: "stairlift-quote" },
];

export type DemoVote = { readonly member: PersonaKey; readonly method: ApprovalMethod; readonly at: Date };

export type DemoProposal = {
  readonly key: string;
  readonly purpose: string;
  readonly kind: ProposalKind;
  readonly cents: number;
  readonly payee: PayeeKey;
  readonly raisedBy: PersonaKey;
  readonly raisedAt: Date;
  readonly note: string | null;
  readonly bill: string | null;
  readonly document: string | null;
  readonly votes: readonly DemoVote[];
};

/**
 * What waits for a yes on the demo clock. The stairlift repair has Rose's
 * spoken yes and needs one more. Amara's week waits for Rose. The settlement's
 * payouts are raised by Kin from the money core and are not listed here.
 */
export const PROPOSALS: readonly DemoProposal[] = [
  {
    key: "stairlift-repair",
    purpose: "stairlift",
    kind: "bill_payment",
    cents: 90000,
    payee: "stairlift",
    raisedBy: "elena",
    raisedAt: new Date("2026-10-29T15:00:00Z"),
    note: null,
    bill: "stairlift",
    document: "stairlift-quote",
    votes: [{ member: "rose", method: "voice", at: new Date("2026-10-29T16:10:00Z") }],
  },
  {
    key: "amara-week-44",
    purpose: "caregiverWeek",
    kind: "caregiver_payout",
    cents: 26400,
    payee: "amara",
    raisedBy: "amara",
    raisedAt: new Date("2026-10-30T13:00:00Z"),
    note: null,
    bill: null,
    document: null,
    votes: [],
  },
];

export type DemoPurchaseRule = {
  readonly seller: PayeeKey;
  readonly item: string;
  readonly category: string;
  readonly priceCents: number;
  readonly limitCents: number;
  readonly monthlyBudgetCents: number;
};

/**
 * What the family let Kin buy for Rose: her monthly prescription from the
 * pharmacy they already pay. The price is above what Rose decides alone
 * ($50), so the refill waits for her spoken yes.
 */
export const PURCHASE_RULES: readonly DemoPurchaseRule[] = [
  { seller: "pharmacy", item: "Monthly prescription refill (30 days)", category: "pharmacy", priceCents: 6400, limitCents: 7500, monthlyBudgetCents: 15000 },
];

export type DemoMandate = {
  readonly seller: PayeeKey;
  readonly perPurchaseCents: number;
  readonly perPeriodCents: number;
  readonly validFrom: string;
  readonly expiresOn: string;
  readonly grantedAt: Date;
  /** What Rose said, as Kin wrote it down. */
  readonly spokenText: string;
};

/**
 * Rose's standing permission, spoken once at the start of the month: Kin may
 * order her prescription from the pharmacy, once a month, up to seventy
 * dollars. It covers the refill's $64.00, so that refill is bought without
 * calling her; a price above seventy would ask her instead.
 */
export const MANDATES: readonly DemoMandate[] = [
  {
    seller: "pharmacy",
    perPurchaseCents: 7000,
    perPeriodCents: 7000,
    validFrom: "2026-10-01",
    expiresOn: "2027-09-30",
    grantedAt: new Date("2026-10-02T15:00:00Z"),
    spokenText: "You may order my blood pressure medication every month, up to seventy dollars, from the pharmacy.",
  },
];

/** When Kin closed the month and raised the settlement. */
export const SETTLED_AT = new Date("2026-10-30T17:00:00Z");

/** November's expected bills. The real amount comes with each bill. */
export const EXPECTED_BILLS: readonly { payee: PayeeKey; kind: ProposalKind; cents: number; dueOn: string }[] = [
  { payee: "gas", kind: "bill_payment", cents: 5700, dueOn: "2026-11-02" },
  { payee: "electricity", kind: "bill_payment", cents: 8400, dueOn: "2026-11-03" },
  { payee: "amara", kind: "caregiver_payout", cents: 26400, dueOn: "2026-11-06" },
  { payee: "pharmacy", kind: "purchase", cents: 4200, dueOn: "2026-11-09" },
];

/** The false demand of day 15: a caller claimed 300.00 for the gas company. */
export const CLAIM_CHECK: {
  checkedOn: string;
  payee: PayeeKey;
  claimedCents: number;
  claim: string;
  /** The ledger source of the last real payment to that payee. */
  foundSource: string;
  verdict: ClaimVerdict;
  alerted: readonly PersonaKey[];
} = {
  checkedOn: "2026-10-15",
  payee: "gas",
  claimedCents: 30000,
  claim: "A caller said Rose owed the gas company 300.00 and had to pay at once by gift card.",
  foundSource: "payout-gas",
  verdict: "no_match",
  alerted: ["elena", "marcus"],
};

export type NarrationTopic = "billPaid" | "refill" | "letter" | "falseDemand" | "caregiverPaid";

/**
 * What Kin told Rose this month. Each amount is read from the ledger entry
 * named by `source` and put into the words, as the number guard requires.
 */
export const NARRATIONS: readonly {
  topic: NarrationTopic;
  saidOn: string;
  source: string;
  claimCheck: boolean;
  words: (amount: string) => string;
}[] = [
  { topic: "billPaid", saidOn: "2026-10-03", source: "payout-electricity", claimCheck: false, words: (amount) => `Your electricity bill of ${amount} is paid.` },
  { topic: "caregiverPaid", saidOn: "2026-10-06", source: "payout-amara", claimCheck: false, words: (amount) => `Amara has been paid ${amount} for her twelve hours.` },
  { topic: "refill", saidOn: "2026-10-09", source: "capture-refill", claimCheck: false, words: (amount) => `Your blood pressure refill of ${amount} is ordered and paid.` },
  { topic: "letter", saidOn: "2026-10-12", source: "bill-water", claimCheck: false, words: (amount) => `That letter is your water bill, for ${amount}. It will be paid before it is due.` },
  {
    topic: "falseDemand",
    saidOn: "2026-10-15",
    source: "payout-gas",
    claimCheck: true,
    words: (amount) => `That call was not from the gas company. Your last gas bill was ${amount}, and it is paid. Please do not buy any gift cards.`,
  },
];

/** Ana's drives to appointments. The ledger values each at the agreement's rate. */
export const CARE: readonly { source: string; member: PersonaKey; occurredOn: string; minutes: number; note: string }[] = [
  { source: "care-ana-5", member: "ana", occurredOn: "2026-10-05", minutes: 45, note: "Drove Rose to the cardiologist" },
  { source: "care-ana-13", member: "ana", occurredOn: "2026-10-13", minutes: 75, note: "Eye appointment, then the pharmacy" },
  { source: "care-ana-21", member: "ana", occurredOn: "2026-10-21", minutes: 48, note: "Physiotherapy" },
  { source: "care-ana-28", member: "ana", occurredOn: "2026-10-28", minutes: 60, note: "Hearing check" },
];
