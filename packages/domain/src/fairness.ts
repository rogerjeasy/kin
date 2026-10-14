import { BASIS_POINTS } from "./agreement.ts";
import { allocate } from "./allocate.ts";
import { assertCents, sumCents } from "./money.ts";

/** What one member gave in a period, with their agreed share. */
export type MemberContribution = {
  readonly memberId: string;
  /** The agreed share in basis points. A circle's shares total 10,000. */
  readonly shareBps: number;
  /** Cash paid into the pool, net of refunds. */
  readonly paidInCents: number;
  /** Approved spending from the member's own pocket. */
  readonly outOfPocketCents: number;
  /** Approved care hours valued at the agreed rate. */
  readonly careCreditCents: number;
  /**
   * What the last settlement left open: above zero when the pool still owes
   * the member, below zero when the member still owes the pool.
   */
  readonly carriedInCents: number;
};

export type FairnessInput = {
  readonly currency: string;
  /** The agreement's switch for paying care credit out as cash. */
  readonly careCreditPaidInCash: boolean;
  readonly members: readonly MemberContribution[];
};

export type MemberPosition = {
  readonly memberId: string;
  /** Everything the member gave: cash, own spending and care credit. */
  readonly contributedCents: number;
  /** The member's agreed share of everything the circle gave. */
  readonly targetCents: number;
  /** The cash the member's share asks for once care credit is counted. */
  readonly cashDueCents: number;
  /** Care credit above the member's target, which earns no cash back. */
  readonly unusedCareCreditCents: number;
  /** Above zero: the pool owes the member. Below zero: the member owes. */
  readonly positionCents: number;
};

export type FairnessResult = {
  readonly currency: string;
  readonly totalContributedCents: number;
  /** One position per member, ordered by member ID. */
  readonly positions: readonly MemberPosition[];
};

/** The inputs cannot be measured against an agreement. Retrying cannot help. */
export class FairnessError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "FairnessError";
  }
}

/**
 * Measures each member against their agreed share, as docs/architecture.md
 * section 7.2 defines it. A pure function: the same inputs always give the
 * same positions.
 *
 * Targets are rounded by the largest-remainder method. Members are taken in
 * order of their ID, so a tied leftover cent goes to the member whose ID sorts
 * first, whatever order the members were given in.
 */
export function calculateFairness(input: FairnessInput): FairnessResult {
  const members = input.members.toSorted(byMemberId);
  assertValidMembers(members);

  const contributed = members.map((member) =>
    sumCents([
      member.paidInCents,
      member.outOfPocketCents,
      member.careCreditCents,
    ]),
  );
  const totalContributedCents = sumCents(contributed);
  if (totalContributedCents < 0) {
    throw new FairnessError("Refunds exceed everything the circle gave");
  }
  const targets = allocate(
    totalContributedCents,
    members.map((member) => member.shareBps),
  );

  const positions = members.map((member, index) => {
    // Safe: `contributed` and `targets` hold one value per member.
    const contributedCents = contributed[index] as number;
    const targetCents = targets[index] as number;
    return positionOf(
      member,
      contributedCents,
      targetCents,
      input.careCreditPaidInCash,
    );
  });
  return { currency: input.currency, totalContributedCents, positions };
}

function positionOf(
  member: MemberContribution,
  contributedCents: number,
  targetCents: number,
  careCreditPaidInCash: boolean,
): MemberPosition {
  const afterCare = targetCents - member.careCreditCents;
  // Paid in cash, care credit beyond the target is owed back to the member.
  // Otherwise it can only bring what the member owes down to nothing.
  const cashDueCents = careCreditPaidInCash ? afterCare : Math.max(0, afterCare);
  return {
    memberId: member.memberId,
    contributedCents,
    targetCents,
    cashDueCents,
    unusedCareCreditCents: cashDueCents - afterCare,
    positionCents: sumCents([
      member.paidInCents,
      member.outOfPocketCents,
      -cashDueCents,
      member.carriedInCents,
    ]),
  };
}

function assertValidMembers(members: readonly MemberContribution[]): void {
  if (members.length === 0) {
    throw new FairnessError("A circle needs at least one member with a share");
  }
  const ids = new Set(members.map((member) => member.memberId));
  if (ids.size !== members.length) {
    throw new FairnessError("A member appears more than once");
  }
  for (const member of members) {
    assertValidMember(member);
  }
  const shareTotal = members.reduce((sum, member) => sum + member.shareBps, 0);
  if (shareTotal !== BASIS_POINTS) {
    throw new FairnessError(
      `Shares must total ${BASIS_POINTS} basis points, got ${shareTotal}`,
    );
  }
}

function assertValidMember(member: MemberContribution): void {
  const { memberId, shareBps } = member;
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > BASIS_POINTS) {
    throw new FairnessError(
      `The share of member "${memberId}" must be between 0 and ${BASIS_POINTS} basis points, got ${shareBps}`,
    );
  }
  assertCents(member.paidInCents);
  assertCents(member.carriedInCents);
  for (const cents of [member.outOfPocketCents, member.careCreditCents]) {
    assertCents(cents);
    if (cents < 0) {
      throw new FairnessError(
        `Own spending and care credit of member "${memberId}" cannot be below zero`,
      );
    }
  }
}

function byMemberId(a: MemberContribution, b: MemberContribution): number {
  if (a.memberId === b.memberId) {
    return 0;
  }
  return a.memberId < b.memberId ? -1 : 1;
}
