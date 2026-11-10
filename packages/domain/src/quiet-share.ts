import { BASIS_POINTS } from "./agreement.ts";
import { allocate } from "./allocate.ts";
import { careValueCents } from "./care.ts";
import { assertCents, sumCents } from "./money.ts";

/**
 * Quiet shares (docs/architecture.md decision 92): a cost too big for the
 * pool is covered by the family's agreed shares, each capped at what the
 * person privately said they can give. Each person's own agent turns their
 * words into a sealed offer; this module is the mediator, plain code that
 * never reads the words and never sees a model. The database runs the same
 * rules a second time, as a security-definer function that hands back only
 * each person's own part and the family's total, and a test holds the two
 * to the same answers.
 */

/** What is being covered: a cost paid once (a repair), or a rise in the monthly budget. */
export const QUIET_SHARE_KINDS = ["one_off", "monthly"] as const;
export type QuietShareKind = (typeof QUIET_SHARE_KINDS)[number];

/** A one-off cost the offers cannot cover at once may be spread over this many months. */
export const SPREAD_MONTHS = 3;

/** How many times one person may seal an offer on one ask: enough to reconsider, too few to probe the others' limits. */
export const MAX_OFFER_SEALS = 3;

/** The most one month of an offer may hold, and the largest cost an ask may cover: the same as a top-up's ceiling times ten. */
export const MAX_OFFER_CENTS = 500_000;
export const MAX_ASK_CENTS = 5_000_000;
/** The most care one offer may promise: 60 hours in the plan's months, and 31 drives or visits. */
export const MAX_CARE_MINUTES = 60 * 60;
export const MAX_CARE_TRIPS = 31;
/** The longest title an ask may have. */
export const MAX_ASK_TITLE = 80;

/**
 * An ask waits for everyone's sealed offer (`gathering`). Once all have
 * answered the mediator either covers the cost (`planned`) or finds it
 * `short`; a short ask is covered by spreading it, by a person taking the
 * gap on with Pay Later, or by someone raising their offer. A plan is
 * `agreed` when every person with a part has accepted their own. An organizer
 * may withdraw an ask that is not agreed. Nothing ever moves back.
 */
export const QUIET_SHARE_TRANSITIONS = {
  gathering: ["planned", "short", "withdrawn"],
  short: ["planned", "withdrawn"],
  planned: ["agreed", "withdrawn"],
  agreed: [],
  withdrawn: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type QuietShareState = keyof typeof QUIET_SHARE_TRANSITIONS;
export const QUIET_SHARE_STATES = Object.keys(QUIET_SHARE_TRANSITIONS) as [QuietShareState, ...QuietShareState[]];

export function quietShareMayMove(from: QuietShareState, to: QuietShareState): boolean {
  return (QUIET_SHARE_TRANSITIONS[from] as readonly QuietShareState[]).includes(to);
}

/** Whether a person may still seal or change their offer. */
export const offersAreOpen = (state: QuietShareState): boolean => state === "gathering" || state === "short";

/** A calendar month, as YYYY-MM. */
export type Month = string;

/** What one person said they can give, as they confirmed it. Private to them. */
export type SealedOffer = {
  readonly memberId: string;
  /** What they can give in a month, from the first month they can. */
  readonly monthlyCents: number;
  /** A later, larger amount a month, from a month on (after a bonus, say). */
  readonly stepUp: { readonly cents: number; readonly fromMonth: Month } | null;
  /** Hands-on help instead of money: drives or visits, and the time they take. */
  readonly careTrips: number;
  readonly careMinutes: number;
  /** The first month they can give anything; `null` for the ask's own month. */
  readonly earliestMonth: Month | null;
  /** They chose to take the family's gap on with PayPal Pay Later. */
  readonly takesShortfall: boolean;
};

/** Why an offer cannot be sealed. Retrying the same offer cannot help. */
export class SealedOfferError extends Error {
  readonly retryable = false;
  readonly reason: "amount" | "step_up" | "care" | "month";

  constructor(reason: SealedOfferError["reason"]) {
    super(`The offer cannot be sealed: ${reason}`);
    this.name = "SealedOfferError";
    this.reason = reason;
  }
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (value: string): boolean => MONTH.test(value);

/** The month `count` months after `month`. */
export function addMonths(month: Month, count: number): Month {
  const match = MONTH.exec(month);
  if (!match) throw new SealedOfferError("month");
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + count;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Checks an offer against the ask's first month: whole cents in range, a step-up that is a rise and comes later, care in range. */
export function checkSealedOffer(offer: SealedOffer, startMonth: Month): SealedOffer {
  for (const cents of [offer.monthlyCents, offer.stepUp?.cents ?? 0]) {
    assertCents(cents);
    if (cents < 0 || cents > MAX_OFFER_CENTS) throw new SealedOfferError("amount");
  }
  if (offer.stepUp !== null && (offer.stepUp.cents <= offer.monthlyCents || !isMonth(offer.stepUp.fromMonth) || offer.stepUp.fromMonth <= startMonth)) throw new SealedOfferError("step_up");
  if (!Number.isSafeInteger(offer.careMinutes) || offer.careMinutes < 0 || offer.careMinutes > MAX_CARE_MINUTES) throw new SealedOfferError("care");
  if (!Number.isSafeInteger(offer.careTrips) || offer.careTrips < 0 || offer.careTrips > MAX_CARE_TRIPS) throw new SealedOfferError("care");
  if (offer.earliestMonth !== null && (!isMonth(offer.earliestMonth) || offer.earliestMonth < startMonth)) throw new SealedOfferError("month");
  return offer;
}

/** What the offer can give in one month: nothing before its first month, the step-up from its month on. */
export function offerInMonth(offer: SealedOffer, month: Month): number {
  if (offer.earliestMonth !== null && month < offer.earliestMonth) return 0;
  return offer.stepUp !== null && month >= offer.stepUp.fromMonth ? offer.stepUp.cents : offer.monthlyCents;
}

export type MediationInput = {
  readonly costCents: number;
  /** The ask's first month, on the circle's clock. */
  readonly startMonth: Month;
  /** 1, or `SPREAD_MONTHS` once the family spread a one-off cost. */
  readonly months: number;
  /** The agreed shares of the people asked. Each above zero; together 10 000. */
  readonly shares: readonly { readonly memberId: string; readonly bps: number }[];
  /** One sealed offer for each person asked. */
  readonly offers: readonly SealedOffer[];
  /** The agreement's care rate, or `null` when care hours do not count. */
  readonly careRateCentsPerHour: number | null;
};

/** One person's part of the plan. Only they see it. */
export type QuietPart = {
  readonly memberId: string;
  /** What they give in money, in total. */
  readonly cents: number;
  /** The same, month by month from the ask's first month. */
  readonly perMonth: readonly number[];
  /** The part above their own offer that they took on with Pay Later. */
  readonly payLaterCents: number;
  /** Their part reached what they offered: the one fact the plan must never show anyone else. */
  readonly atLimit: boolean;
  /** What their agreed share alone would have asked. */
  readonly shareCents: number;
  readonly careTrips: number;
  readonly careMinutes: number;
  /** Their care at the agreement's rate. It is counted toward fairness when the care is done, and never pays the cost. */
  readonly careValueCents: number;
};

export type MediationResult = {
  /** One part per person, in member-ID order. */
  readonly parts: readonly QuietPart[];
  readonly coveredCents: number;
  /** What the offers leave uncovered: the only thing a family is told when they fall short. */
  readonly shortfallCents: number;
};

/** The offers cannot be mediated: a broken input, never a person's choice. Retrying cannot help. */
export class MediationError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "MediationError";
  }
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Shares the cost out. First by the agreed shares, each capped at what the
 * person offered over the ask's months; what the caps leave over goes to the
 * people with room, again in proportion to their shares, round after round,
 * until it is all placed or nobody has room. Every rounding is the
 * largest-remainder method of `allocate`, with ties to the member whose ID
 * sorts first, so the answer never depends on the order the offers came in.
 * A gap that remains goes to whoever chose to take it on with Pay Later
 * (split by their shares if several did); otherwise it is the shortfall.
 */
export function mediateQuietShare(input: MediationInput): MediationResult {
  const { members, capacities, monthly } = prepare(input);
  const parts = members.map(() => 0);
  let remaining = input.costCents;
  let open = members.map((_, index) => index).filter((index) => (capacities[index] ?? 0) > 0);
  while (remaining > 0 && open.length > 0) {
    const given = allocate(remaining, open.map((index) => members[index]?.bps ?? 0));
    let placed = 0;
    open.forEach((index, position) => {
      const room = (capacities[index] ?? 0) - (parts[index] ?? 0);
      const take = Math.min(given[position] ?? 0, room);
      parts[index] = (parts[index] ?? 0) + take;
      placed += take;
    });
    remaining -= placed;
    open = open.filter((index) => (parts[index] ?? 0) < (capacities[index] ?? 0));
  }

  const takers = members.map((member, index) => ({ member, index })).filter(({ member }) => member.offer.takesShortfall);
  const payLater = members.map(() => 0);
  if (remaining > 0 && takers.length > 0) {
    allocate(remaining, takers.map(({ member }) => member.bps)).forEach((cents, position) => {
      const index = takers[position]?.index ?? 0;
      payLater[index] = cents;
    });
    remaining = 0;
  }
  const targets = allocate(input.costCents, members.map((member) => member.bps));

  const result: QuietPart[] = members.map((member, index) => {
    const withinOffer = parts[index] ?? 0;
    const later = payLater[index] ?? 0;
    const months = monthly[index] ?? [];
    // Within the offer, each month gives in proportion to what that month can; Pay Later is paid in the first.
    const spread = months.some((cents) => cents > 0) ? allocate(withinOffer, months) : months.map(() => 0);
    const perMonth = spread.map((cents, month) => cents + (month === 0 ? later : 0));
    const { careTrips, careMinutes } = member.offer;
    return {
      memberId: member.memberId,
      cents: withinOffer + later,
      perMonth,
      payLaterCents: later,
      atLimit: withinOffer === (capacities[index] ?? 0) && withinOffer < (targets[index] ?? 0),
      shareCents: targets[index] ?? 0,
      careTrips,
      careMinutes,
      careValueCents: careMinutes > 0 && input.careRateCentsPerHour !== null ? careValueCents(careMinutes, input.careRateCentsPerHour) : 0,
    };
  });
  return { parts: result, coveredCents: input.costCents - remaining, shortfallCents: remaining };
}

/** Whether spreading a short one-off cost over `SPREAD_MONTHS` would cover it, without saying anything about anyone. */
export function spreadWouldCover(input: MediationInput): boolean {
  return mediateQuietShare({ ...input, months: SPREAD_MONTHS, offers: input.offers.map((offer) => ({ ...offer, takesShortfall: false })) }).shortfallCents === 0;
}

type Prepared = {
  readonly members: readonly { readonly memberId: string; readonly bps: number; readonly offer: SealedOffer }[];
  readonly capacities: readonly number[];
  readonly monthly: readonly (readonly number[])[];
};

function prepare(input: MediationInput): Prepared {
  assertCents(input.costCents);
  if (input.costCents <= 0 || input.costCents > MAX_ASK_CENTS) throw new MediationError(`The cost must be above zero and at most ${MAX_ASK_CENTS}, got ${input.costCents}`);
  if (!Number.isSafeInteger(input.months) || input.months < 1 || input.months > SPREAD_MONTHS) throw new MediationError(`An ask runs over 1 to ${SPREAD_MONTHS} months, got ${input.months}`);
  if (!isMonth(input.startMonth)) throw new MediationError("The ask's first month is not a month");
  const shares = input.shares.toSorted((a, b) => byId(a.memberId, b.memberId));
  if (shares.length === 0) throw new MediationError("Nobody is asked");
  if (new Set(shares.map((share) => share.memberId)).size !== shares.length) throw new MediationError("A person is asked twice");
  if (shares.some((share) => !Number.isSafeInteger(share.bps) || share.bps <= 0) || sumCents(shares.map((share) => share.bps)) !== BASIS_POINTS) {
    throw new MediationError(`The shares must each be above zero and total ${BASIS_POINTS}`);
  }
  const offers = new Map(input.offers.map((offer) => [offer.memberId, offer]));
  if (offers.size !== input.offers.length || offers.size !== shares.length) throw new MediationError("Every person asked needs exactly one offer");
  const months = Array.from({ length: input.months }, (_, index) => addMonths(input.startMonth, index));
  const members = shares.map((share) => {
    const offer = offers.get(share.memberId);
    if (offer === undefined) throw new MediationError("An offer names someone who was not asked");
    return { memberId: share.memberId, bps: share.bps, offer: checkSealedOffer(offer, input.startMonth) };
  });
  const monthly = members.map((member) => months.map((month) => offerInMonth(member.offer, month)));
  return { members, monthly, capacities: monthly.map((each) => sumCents(each)) };
}

/**
 * When someone's limit can be worked out from what the others see, and how,
 * so the screen can say so. `pair`: with only two people sharing, the one not
 * at their limit sees their own part and the total, and so the other's part,
 * which is the other's limit when they are at it. `comparing`: when three or
 * more fall short, every part is exactly its person's limit, so all but one
 * who compare their parts can subtract them from what was covered and get the
 * last one's. Otherwise nobody can, alone or together, tell a part at a limit
 * from one that is not. The exact shortfall is still shown: it is the one fact
 * the family needs to close the gap.
 */
export function limitsCanBeDeduced(askedCount: number, state: QuietShareState): "pair" | "comparing" | null {
  if (state === "withdrawn") return null;
  if (askedCount === 2) return "pair";
  return askedCount >= 3 && state === "short" ? "comparing" : null;
}

/** The PayPal action that carries a person's part, once the plan is agreed. */
export const QUIET_PART_METHODS = ["checkout", "pay_later", "invoice", "monthly_share"] as const;
export type QuietPartMethod = (typeof QUIET_PART_METHODS)[number];

/**
 * The ways a part may be paid: a monthly rise by the person's monthly share
 * (Subscriptions revise, or a new share); a one-off by PayPal checkout, where
 * PayPal offers Pay Later, or by a PayPal invoice. A part taken on with Pay
 * Later is paid by checkout with Pay Later.
 */
export function partMethods(kind: QuietShareKind, part: Pick<QuietPart, "payLaterCents">): readonly QuietPartMethod[] {
  if (kind === "monthly") return ["monthly_share"];
  return part.payLaterCents > 0 ? ["pay_later"] : ["checkout", "pay_later", "invoice"];
}
