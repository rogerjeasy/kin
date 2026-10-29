import { BASIS_POINTS, type Agreement, type ApprovalTerms, type CareTerms, type Share } from "./agreement.ts";
import { assertCents } from "./money.ts";

/** The terms a family writes into one version of its agreement. */
export type AgreementTerms = {
  readonly shares: readonly Share[];
  readonly care: CareTerms | null;
  readonly approvals: ApprovalTerms;
  /** The calendar day, in the circle's timezone, from which the version governs. */
  readonly effectiveOn: string;
};

/** Why proposed terms cannot become an agreement. Retrying the same terms cannot help. */
export class AgreementTermsError extends Error {
  readonly retryable = false;
  readonly reason:
    | "no_shares"
    | "share"
    | "share_member"
    | "duplicate_member"
    | "shares_total"
    | "ceiling"
    | "threshold"
    | "threshold_above_ceiling"
    | "care_rate"
    | "effective_date";

  constructor(reason: AgreementTermsError["reason"]) {
    super(`The agreement cannot be written: ${reason}`);
    this.name = "AgreementTermsError";
    this.reason = reason;
  }
}

/**
 * Checks a version's terms against every rule the money core relies on:
 * whole basis points from members who may share the cost, totalling exactly
 * 10 000; a ceiling above zero with both thresholds at or below it; a care
 * rate when care counts; and a start no earlier than today.
 */
export function checkAgreementTerms(terms: AgreementTerms, context: { readonly today: string; readonly sharingMemberIds: readonly string[] }): AgreementTerms {
  if (terms.shares.length === 0) fail("no_shares");
  const seen = new Set<string>();
  for (const share of terms.shares) {
    if (!Number.isSafeInteger(share.bps) || share.bps <= 0 || share.bps > BASIS_POINTS) fail("share");
    if (!context.sharingMemberIds.includes(share.memberId)) fail("share_member");
    if (seen.has(share.memberId)) fail("duplicate_member");
    seen.add(share.memberId);
  }
  if (terms.shares.reduce((sum, share) => sum + share.bps, 0) !== BASIS_POINTS) fail("shares_total");

  const { ceilingCents, secondApprovalAboveCents, parentDecidesAboveCents } = terms.approvals;
  for (const cents of [ceilingCents, secondApprovalAboveCents, parentDecidesAboveCents]) {
    if (!Number.isSafeInteger(cents) || cents < 0) fail("threshold");
    assertCents(cents);
  }
  if (ceilingCents <= 0) fail("ceiling");
  if (secondApprovalAboveCents > ceilingCents || parentDecidesAboveCents > ceilingCents) fail("threshold_above_ceiling");

  if (terms.care !== null && (!Number.isSafeInteger(terms.care.rateCentsPerHour) || terms.care.rateCentsPerHour <= 0)) fail("care_rate");
  if (!isCalendarDay(terms.effectiveOn) || terms.effectiveOn < context.today) fail("effective_date");
  return terms;
}

/**
 * A share typed as a percentage, to two decimals, in basis points: `33.33`
 * is 3 333. Read digit by digit, never through a float, so what the family
 * typed is exactly what is stored.
 */
export function bpsFromPercent(text: string): number {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) fail("share");
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  if (bps <= 0 || bps > BASIS_POINTS) fail("share");
  return bps;
}

/** Basis points as the percentage a form shows: 3 333 is `33.33`, 5 000 is `50`. */
export function percentFromBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/** What Kin knows about one version when it decides which governs. */
export type VersionFacts = {
  readonly version: number;
  readonly effectiveOn: string;
  /**
   * Whose acceptance the version needs: every organizer and contributor, and
   * a parent who decides, as fixed when it was proposed.
   */
  readonly requiredMemberIds: readonly string[];
  readonly acceptedMemberIds: readonly string[];
};

export type VersionStatus =
  /** The version that governs today. */
  | "in_force"
  /** Accepted by everyone it asks, and waiting for its start date. */
  | "scheduled"
  /** The newest version, still waiting for acceptances. */
  | "awaiting"
  /** Never accepted by everyone, and replaced by a newer proposal. */
  | "superseded"
  /** Governed once, and replaced by a later version. */
  | "earlier";

export type AgreementStanding = {
  /** The version that governs today, or `null` before any has been accepted. */
  readonly inForce: number | null;
  readonly statuses: ReadonlyMap<number, VersionStatus>;
  /** For each version waiting for acceptance, the members it still waits for. */
  readonly waitingFor: ReadonlyMap<number, readonly string[]>;
};

/**
 * Which version governs: the newest one that every member it asks has
 * accepted, from its start date. It asks every organizer and contributor, not
 * only those it gives a share, so no one can write themselves the only share
 * and be the only one asked. Only the newest version can still be accepted;
 * an older one that never was is superseded.
 */
export function agreementStanding(versions: readonly VersionFacts[], today: string): AgreementStanding {
  const ordered = versions.toSorted((a, b) => a.version - b.version);
  const waitingFor = new Map(ordered.map((each) => [each.version, each.requiredMemberIds.filter((member) => !each.acceptedMemberIds.includes(member))] as const));
  const accepted = (each: VersionFacts) => (waitingFor.get(each.version) ?? []).length === 0;
  const inForce = ordered.findLast((each) => accepted(each) && each.effectiveOn <= today)?.version ?? null;
  const newest = ordered.at(-1)?.version ?? null;
  const statuses = new Map<number, VersionStatus>();
  for (const each of ordered) {
    const status: VersionStatus =
      each.version === inForce
        ? "in_force"
        : inForce !== null && each.version < inForce
          ? "earlier"
          : accepted(each)
            ? "scheduled"
            : each.version === newest
              ? "awaiting"
              : "superseded";
    statuses.set(each.version, status);
  }
  return { inForce, statuses, waitingFor: new Map([...waitingFor].filter(([version]) => statuses.get(version) === "awaiting")) };
}

export type AgreementChange =
  | { readonly kind: "share"; readonly memberId: string; readonly fromBps: number | null; readonly toBps: number | null }
  | { readonly kind: "threshold"; readonly which: "ceiling" | "second" | "parent"; readonly fromCents: number | null; readonly toCents: number }
  | { readonly kind: "care_rate"; readonly fromCents: number | null; readonly toCents: number | null }
  | { readonly kind: "care_cash"; readonly to: boolean };

/**
 * What a proposed version changes, term by term, in the order a family reads
 * them: shares in the new version's order, then members who no longer share,
 * then care, then the approval amounts. Against no version, every term is new.
 */
export function agreementChanges(from: Pick<Agreement, "shares" | "care" | "approvals"> | null, to: Pick<Agreement, "shares" | "care" | "approvals">): AgreementChange[] {
  const before = new Map((from?.shares ?? []).map((share) => [share.memberId, share.bps]));
  const after = new Map(to.shares.map((share) => [share.memberId, share.bps]));
  const shares: AgreementChange[] = [
    ...to.shares.filter((share) => before.get(share.memberId) !== share.bps).map((share) => ({ kind: "share" as const, memberId: share.memberId, fromBps: before.get(share.memberId) ?? null, toBps: share.bps })),
    ...(from?.shares ?? []).filter((share) => !after.has(share.memberId)).map((share) => ({ kind: "share" as const, memberId: share.memberId, fromBps: share.bps, toBps: null })),
  ];
  const fromRate = from === null ? null : (from.care?.rateCentsPerHour ?? null);
  const toRate = to.care?.rateCentsPerHour ?? null;
  const care: AgreementChange[] = [
    ...(from === null || fromRate !== toRate ? (toRate === null && fromRate === null ? [] : [{ kind: "care_rate" as const, fromCents: fromRate, toCents: toRate }]) : []),
    ...((from?.care?.paidInCash ?? false) !== (to.care?.paidInCash ?? false) ? [{ kind: "care_cash" as const, to: to.care?.paidInCash ?? false }] : []),
  ];
  const thresholds = (
    [
      ["parent", "parentDecidesAboveCents"],
      ["second", "secondApprovalAboveCents"],
      ["ceiling", "ceilingCents"],
    ] as const
  ).flatMap(([which, key]): AgreementChange[] => {
    const toCents = to.approvals[key];
    const fromCents = from?.approvals[key];
    return fromCents === toCents ? [] : [{ kind: "threshold", which, fromCents: fromCents ?? null, toCents }];
  });
  return [...shares, ...care, ...thresholds];
}

function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function fail(reason: AgreementTermsError["reason"]): never {
  throw new AgreementTermsError(reason);
}
