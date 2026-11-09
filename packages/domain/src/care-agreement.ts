/**
 * The written agreement between the person who needs care, or someone acting
 * for them, and the person who gives it. Kin fills a fixed template from these
 * facts; the model never writes a clause. Kin does not give legal advice: every
 * screen that shows one says it is prepared for the family's attorney.
 */

export const CARE_RELATIONS = ["child", "other_relative", "not_related", "spouse"] as const;
export type CareRelation = (typeof CARE_RELATIONS)[number];

export const CARE_END_TERMS = ["either_party_30_days", "fixed_end_date"] as const;
export type CareEndTerm = (typeof CARE_END_TERMS)[number];

/** Whose money pays for the care: the care recipient's own, or the family's. A lawyer asks, so the agreement says. */
export const CARE_PAYERS = ["care_recipient", "family_members"] as const;
export type CarePayer = (typeof CARE_PAYERS)[number];

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;
export type UsState = (typeof US_STATES)[number];

export const MAX_DUTIES = 12;
export const MAX_DUTY_CHARS = 200;
/** A week has 10 080 minutes; no one is employed for more than 84 hours of it. */
export const MAX_WEEKLY_MINUTES = 84 * 60;

export type CareAgreementTerms = {
  /** The caregiver's payee row: the agreement governs what the pool pays it. */
  readonly payeeId: string;
  readonly caregiverMemberId: string;
  readonly caregiverRelation: CareRelation;
  readonly duties: readonly string[];
  readonly weeklyMinutes: number;
  readonly rateCentsPerHour: number;
  /** The first day the agreement governs, as YYYY-MM-DD, once it is signed. */
  readonly startsOn: string;
  readonly endTerm: CareEndTerm;
  /** Only with `fixed_end_date`. */
  readonly endsOn: string | null;
  readonly payer: CarePayer;
  readonly state: UsState;
};

export type CareAgreementTermsReason = "spouse" | "relation" | "duties" | "hours" | "rate" | "start_date" | "end_term" | "end_date" | "payer" | "state";

/** The terms cannot become an agreement. Retrying the same terms cannot help. */
export class CareAgreementTermsError extends Error {
  readonly retryable = false;
  readonly reason: CareAgreementTermsReason;

  constructor(reason: CareAgreementTermsReason) {
    super(`The care agreement cannot be written: ${reason}`);
    this.name = "CareAgreementTermsError";
    this.reason = reason;
  }
}

/**
 * Checks the terms against every rule the template relies on. A spouse is
 * refused with its own reason: an agreement with a spouse does not help for
 * Medicaid spend-down, so Kin warns instead of drafting one.
 */
export function checkCareAgreementTerms(terms: CareAgreementTerms): CareAgreementTerms {
  if (!(CARE_RELATIONS as readonly string[]).includes(terms.caregiverRelation)) fail("relation");
  if (terms.caregiverRelation === "spouse") fail("spouse");
  const duties = terms.duties.map((duty) => duty.trim());
  if (duties.length === 0 || duties.length > MAX_DUTIES || duties.some((duty) => duty.length === 0 || duty.length > MAX_DUTY_CHARS || /[<>]/.test(duty))) fail("duties");
  if (!Number.isSafeInteger(terms.weeklyMinutes) || terms.weeklyMinutes <= 0 || terms.weeklyMinutes > MAX_WEEKLY_MINUTES) fail("hours");
  if (!Number.isSafeInteger(terms.rateCentsPerHour) || terms.rateCentsPerHour <= 0 || terms.rateCentsPerHour > 1_000_000) fail("rate");
  if (!isDay(terms.startsOn)) fail("start_date");
  if (!(CARE_END_TERMS as readonly string[]).includes(terms.endTerm)) fail("end_term");
  if (terms.endTerm === "fixed_end_date" ? terms.endsOn === null || !isDay(terms.endsOn) || terms.endsOn <= terms.startsOn : terms.endsOn !== null) fail("end_date");
  if (!(CARE_PAYERS as readonly string[]).includes(terms.payer)) fail("payer");
  if (!(US_STATES as readonly string[]).includes(terms.state)) fail("state");
  return { ...terms, duties };
}

/** Who signs for the care recipient: the person themselves, or the organizer acting for them. */
export const SIGNING_CAPACITIES = ["caregiver", "care_recipient", "representative"] as const;
export type SigningCapacity = (typeof SIGNING_CAPACITIES)[number];

export type CareAgreementSignature = {
  readonly memberId: string;
  readonly capacity: SigningCapacity;
  /** The calendar day, on the circle's clock. */
  readonly signedOn: string;
};

/** What Kin knows of one agreement when it decides whether it covers a day of work. */
export type CareAgreementFacts = {
  readonly id: string;
  readonly payeeId: string;
  /** A draft waits for signatures; a withdrawn one never governs and is not counted. */
  readonly state: "draft" | "withdrawn";
  /** The rate the agreement states. Kin pays a day of work only at this rate. */
  readonly rateCentsPerHour: number;
  readonly startsOn: string;
  readonly endTerm: CareEndTerm;
  readonly endsOn: string | null;
  /** Set when the family ended it early, by the last day it covers. */
  readonly endedOn: string | null;
  readonly signatures: readonly CareAgreementSignature[];
};

export type CareAgreementStatus = "withdrawn" | "draft" | "scheduled" | "active" | "ended";

const signedBy = (facts: CareAgreementFacts, capacities: readonly SigningCapacity[]) => facts.signatures.some((signature) => capacities.includes(signature.capacity));

/** Signed by the caregiver and by the care recipient or someone acting for them. */
export function isFullySigned(facts: CareAgreementFacts): boolean {
  return signedBy(facts, ["caregiver"]) && signedBy(facts, ["care_recipient", "representative"]);
}

/**
 * The first day the agreement covers work: its start, or the day the last
 * signature was given if that is later. An agreement is never retroactive, so
 * work done before it was signed is not covered by it. `null` until signed.
 */
export function coveredFrom(facts: CareAgreementFacts): string | null {
  if (facts.state !== "draft" || !isFullySigned(facts)) return null;
  const lastSigned = facts.signatures.map((signature) => signature.signedOn).toSorted().at(-1) ?? facts.startsOn;
  return lastSigned > facts.startsOn ? lastSigned : facts.startsOn;
}

/** The last day the agreement covers, or `null` when it runs until either side ends it. */
export function coveredUntil(facts: CareAgreementFacts): string | null {
  const days = [facts.endedOn, facts.endsOn].filter((day): day is string => day !== null).toSorted();
  return days[0] ?? null;
}

export function careAgreementStatus(facts: CareAgreementFacts, today: string): CareAgreementStatus {
  if (facts.state === "withdrawn") return "withdrawn";
  const from = coveredFrom(facts);
  if (from === null) return "draft";
  const until = coveredUntil(facts);
  if (until !== null && until < today) return "ended";
  return from > today ? "scheduled" : "active";
}

/** True when the signing came after the agreed start, so the first days it names are not covered. */
export function signedAfterStart(facts: CareAgreementFacts): boolean {
  const from = coveredFrom(facts);
  return from !== null && from > facts.startsOn;
}

/**
 * Why no agreement covers a day of work. `rate_differs`: one covers the day,
 * but at another rate than the one being paid, so the pay waits for an
 * agreement at the new rate.
 */
export type NotCoveredReason = "unsigned" | "before_signed" | "after_end" | "rate_differs";

export type WorkCoverage =
  /** An agreement covers the day, at the rate being paid. */
  | { readonly kind: "covered"; readonly agreementId: string }
  /** The caregiver has no agreement on file at all: the pay is allowed and is listed as undocumented. */
  | { readonly kind: "undocumented" }
  /** The caregiver has agreements, and none covers the day at the rate being paid. */
  | { readonly kind: "not_covered"; readonly reason: NotCoveredReason };

const coversDay = (facts: CareAgreementFacts, workDate: string): boolean => {
  const from = coveredFrom(facts);
  const until = coveredUntil(facts);
  return from !== null && workDate >= from && (until === null || workDate <= until);
};

/**
 * Whether a day of work is covered by the caregiver's agreements. Once a
 * caregiver has one on file, only work it covers can be paid, and only at the
 * rate it states; before that, the pay is allowed but lands on the look-back
 * list as lacking documentation. `rateCentsPerHour` is the rate being paid,
 * or `null` when the record does not know it, and then only the day is judged.
 */
export function workCoverage(workDate: string, agreements: readonly CareAgreementFacts[], rateCentsPerHour: number | null): WorkCoverage {
  const own = agreements.filter((facts) => facts.state !== "withdrawn");
  if (own.length === 0) return { kind: "undocumented" };
  const covering = own.filter((facts) => coversDay(facts, workDate));
  const atRate = covering.find((facts) => rateCentsPerHour === null || facts.rateCentsPerHour === rateCentsPerHour);
  if (atRate !== undefined) return { kind: "covered", agreementId: atRate.id };
  if (covering.length > 0) return { kind: "not_covered", reason: "rate_differs" };
  const signed = own.filter((facts) => coveredFrom(facts) !== null);
  if (signed.length === 0) return { kind: "not_covered", reason: "unsigned" };
  const firstFrom = signed.map((facts) => coveredFrom(facts) ?? "").toSorted()[0] ?? "";
  return { kind: "not_covered", reason: workDate < firstFrom ? "before_signed" : "after_end" };
}

/**
 * The agreement that replaced this one: when a newer agreement for the same
 * caregiver was signed, the database ended this one on the day before the
 * newer one began to cover work. `null` when it was not replaced.
 */
export function replacedBy(facts: CareAgreementFacts, agreements: readonly CareAgreementFacts[]): CareAgreementFacts | null {
  if (facts.endedOn === null) return null;
  const next = dayAfter(facts.endedOn);
  return agreements.find((other) => other.id !== facts.id && other.payeeId === facts.payeeId && other.state !== "withdrawn" && coveredFrom(other) === next) ?? null;
}

/** A caregiver payout names work that no signed agreement covers at the rate paid. Retrying cannot help; a signature can. */
export class CareAgreementGateError extends Error {
  readonly retryable = false;
  readonly reason: NotCoveredReason;
  /** The first uncovered day. */
  readonly workDate: string;

  constructor(reason: CareAgreementGateError["reason"], workDate: string) {
    super(`The care agreement does not cover ${workDate}: ${reason}`);
    this.name = "CareAgreementGateError";
    this.reason = reason;
    this.workDate = workDate;
  }
}

/**
 * Refuses a payout for any work date before the caregiver's agreement is
 * signed and in force, after it ended, or at a rate it does not state.
 */
export function assertWorkCovered(workDates: readonly string[], agreements: readonly CareAgreementFacts[], rateCentsPerHour: number): void {
  for (const day of workDates.toSorted()) {
    const coverage = workCoverage(day, agreements, rateCentsPerHour);
    if (coverage.kind === "not_covered") throw new CareAgreementGateError(coverage.reason, day);
  }
}

/** Whole and part hours: 1 500 minutes is "25 hours", 90 is "1 hour 30 minutes". */
export function hoursText(minutes: number): string {
  const hours = Math.trunc(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 0 ? "" : `${hours} hour${hours === 1 ? "" : "s"}`;
  const minutePart = rest === 0 ? "" : `${rest} minute${rest === 1 ? "" : "s"}`;
  return [hourPart, minutePart].filter((part) => part !== "").join(" ") || "0 minutes";
}

export type CareAgreementNames = {
  readonly caregiver: string;
  readonly careRecipient: string;
  /** The rate already formatted for the reader ("$30.00"). */
  readonly rate: string;
  /** A day already formatted for the reader. */
  readonly day: (iso: string) => string;
};

export type AgreementClause = { readonly heading: string; readonly body: readonly string[] };

export const AGREEMENT_FOOTER = "Prepared with Kin for your attorney. Kin is not a law firm and this is not legal advice. State rules differ: have an elder-law attorney review it before anyone signs.";

/**
 * The agreement's text. Every sentence is fixed wording with the family's
 * facts filled in; nothing here comes from a model. Rules differ by state, so
 * the template says which state's law the family named and nothing more.
 */
export function careAgreementClauses(terms: CareAgreementTerms, names: CareAgreementNames): readonly AgreementClause[] {
  const { caregiver, careRecipient } = names;
  const payerText =
    terms.payer === "care_recipient"
      ? `${careRecipient} pays ${caregiver} from ${careRecipient}'s own funds, through the family's care account.`
      : `${caregiver} is paid from money that members of ${careRecipient}'s family put into the family's care account; it is not paid from ${careRecipient}'s own funds.`;
  const endText =
    terms.endTerm === "fixed_end_date"
      ? `This agreement ends on ${names.day(terms.endsOn ?? terms.startsOn)}, unless the parties sign a new one.`
      : "This agreement continues until either party ends it by giving the other 30 days' written notice.";
  return [
    { heading: "1. The parties", body: [`${careRecipient} (the care recipient) and ${caregiver} (the caregiver) agree as follows. ${caregiver} is the care recipient's ${relationText(terms.caregiverRelation)}.`] },
    { heading: "2. Services", body: ["The caregiver will provide these services:", ...terms.duties.map((duty, index) => `${index + 1}. ${duty}`)] },
    {
      heading: "3. Hours and pay",
      body: [
        `The caregiver is expected to work about ${hoursText(terms.weeklyMinutes)} a week and is paid ${names.rate} for each hour worked, for the time actually worked.`,
        "Pay is for care given after this agreement is signed. Nothing is paid for care given before it.",
      ],
    },
    { heading: "4. Where the money comes from", body: [payerText] },
    {
      heading: "5. Records",
      body: [
        "Each visit is recorded when the caregiver checks in and out and the family confirms it. Each payment is made through PayPal and is recorded in the family's care account with PayPal's own reference.",
        "The parties keep these records, and the payroll records the law asks for, and give them to anyone the care recipient asks them to.",
      ],
    },
    {
      heading: "6. Fair pay, not a gift",
      body: ["The pay is a fair price for services. It is not a gift, and the parties do not intend it to be one."],
    },
    { heading: "7. Start and end", body: [`This agreement starts on ${names.day(terms.startsOn)}, or on the day the last party signs it if that is later.`, endText] },
    { heading: "8. Law", body: [`The parties name the state of ${terms.state} as the state whose law they intend to govern this agreement.`] },
  ];
}

function relationText(relation: CareRelation): string {
  return relation === "child" ? "child" : relation === "other_relative" ? "relative" : relation === "spouse" ? "spouse" : "friend or hired helper";
}

const DAY_MS = 86_400_000;

/** The calendar day after `day`, both as YYYY-MM-DD. */
function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function fail(reason: CareAgreementTermsReason): never {
  throw new CareAgreementTermsError(reason);
}
