/** Shares are whole basis points, and a circle's shares total this. */
export const BASIS_POINTS = 10_000;

export type Share = {
  readonly memberId: string;
  readonly bps: number;
};

/** How the family values hands-on care. */
export type CareTerms = {
  readonly rateCentsPerHour: number;
  /**
   * Off by default: care hours lower what a member owes in cash and are not
   * paid out. On: care credit counts like cash and can be paid out.
   */
  readonly paidInCash: boolean;
};

/** The amounts at which the approval engine asks for more, in cents. */
export type ApprovalTerms = {
  /** No single movement may be above this, whoever approves it. */
  readonly ceilingCents: number;
  /** Above this, two members must agree. */
  readonly secondApprovalAboveCents: number;
  /** Above this, a parent who decides must say yes. */
  readonly parentDecidesAboveCents: number;
};

/** The part of a circle's versioned agreement that the money core reads. */
export type Agreement = {
  readonly version: number;
  readonly shares: readonly Share[];
  /** `null` when the family has not agreed that care hours count. */
  readonly care: CareTerms | null;
  readonly approvals: ApprovalTerms;
};
