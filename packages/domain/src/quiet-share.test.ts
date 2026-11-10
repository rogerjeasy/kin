import { describe, expect, it } from "vitest";

import { allocate } from "./allocate.ts";
import {
  MAX_OFFER_CENTS,
  MediationError,
  QUIET_SHARE_TRANSITIONS,
  SPREAD_MONTHS,
  SealedOfferError,
  addMonths,
  checkSealedOffer,
  limitsCanBeDeduced,
  mediateQuietShare,
  offerInMonth,
  partMethods,
  quietShareMayMove,
  spreadWouldCover,
  type MediationInput,
  type SealedOffer,
} from "./quiet-share.ts";
import { randomShares } from "./testing/generators.ts";
import { forAll, type Random } from "./testing/property.ts";

const offer = (memberId: string, monthlyCents: number, change: Partial<SealedOffer> = {}): SealedOffer => ({
  memberId,
  monthlyCents,
  stepUp: null,
  careTrips: 0,
  careMinutes: 0,
  earliestMonth: null,
  takesShortfall: false,
  ...change,
});

/** Rose's family: Marcus 50 %, Elena 30 %, Ana 20 %, and a $25 care rate. */
const stairlift = (offers: readonly SealedOffer[], change: Partial<MediationInput> = {}): MediationInput => ({
  costCents: 90_000,
  startMonth: "2026-11",
  months: 1,
  shares: [
    { memberId: "marcus", bps: 5000 },
    { memberId: "elena", bps: 3000 },
    { memberId: "ana", bps: 2000 },
  ],
  offers,
  careRateCentsPerHour: 2500,
  ...change,
});

const partsOf = (input: MediationInput) => Object.fromEntries(mediateQuietShare(input).parts.map((part) => [part.memberId, part.cents]));

describe("the quiet-share mediator", () => {
  it("covers the stairlift as the demo tells it: Marcus 540, Elena 300, Ana 60 and her two drives", () => {
    const result = mediateQuietShare(stairlift([offer("marcus", 60_000), offer("elena", 30_000), offer("ana", 6_000, { careTrips: 2, careMinutes: 180 })]));
    expect(result.shortfallCents).toBe(0);
    expect(result.coveredCents).toBe(90_000);
    expect(result.parts).toEqual([
      { memberId: "ana", cents: 6_000, perMonth: [6_000], payLaterCents: 0, atLimit: true, shareCents: 18_000, careTrips: 2, careMinutes: 180, careValueCents: 7_500 },
      { memberId: "elena", cents: 30_000, perMonth: [30_000], payLaterCents: 0, atLimit: false, shareCents: 27_000, careTrips: 0, careMinutes: 0, careValueCents: 0 },
      { memberId: "marcus", cents: 54_000, perMonth: [54_000], payLaterCents: 0, atLimit: false, shareCents: 45_000, careTrips: 0, careMinutes: 0, careValueCents: 0 },
    ]);
  });

  it("asks exactly the agreed shares when nobody's offer binds", () => {
    expect(partsOf(stairlift([offer("marcus", 100_000), offer("elena", 100_000), offer("ana", 100_000)]))).toEqual({ ana: 18_000, elena: 27_000, marcus: 45_000 });
  });

  it("says only how much is short when the offers fall short", () => {
    const result = mediateQuietShare(stairlift([offer("marcus", 50_000), offer("elena", 28_000), offer("ana", 0)]));
    expect(result.shortfallCents).toBe(12_000);
    expect(result.parts.map((part) => part.cents)).toEqual([0, 28_000, 50_000]);
  });

  it("closes the gap with Pay Later for whoever took it on, above their own offer", () => {
    const result = mediateQuietShare(stairlift([offer("marcus", 50_000, { takesShortfall: true }), offer("elena", 28_000), offer("ana", 0)]));
    expect(result.shortfallCents).toBe(0);
    expect(result.parts.find((part) => part.memberId === "marcus")).toMatchObject({ cents: 62_000, payLaterCents: 12_000, perMonth: [62_000] });
  });

  it("spreads a one-off cost over three months, counting a later step-up and a first month", () => {
    const offers = [offer("marcus", 30_000), offer("elena", 20_000), offer("ana", 6_000, { stepUp: { cents: 15_000, fromMonth: "2026-12" } })];
    expect(mediateQuietShare(stairlift(offers)).shortfallCents).toBe(34_000);
    expect(spreadWouldCover(stairlift(offers))).toBe(true);
    const spread = mediateQuietShare(stairlift(offers, { months: SPREAD_MONTHS }));
    expect(spread.shortfallCents).toBe(0);
    const ana = spread.parts.find((part) => part.memberId === "ana");
    expect(ana?.cents).toBe(18_000);
    expect(ana?.perMonth).toEqual([3_000, 7_500, 7_500]);
    expect(offerInMonth(offer("x", 100, { earliestMonth: "2027-01" }), "2026-12")).toBe(0);
  });

  it("never lets care pay the cost: it is valued at the rate, and counts toward fairness when it is done", () => {
    const result = mediateQuietShare(stairlift([offer("marcus", 0), offer("elena", 0), offer("ana", 0, { careMinutes: 600 })]));
    expect(result.shortfallCents).toBe(90_000);
    expect(result.parts[0]?.careValueCents).toBe(25_000);
    expect(mediateQuietShare(stairlift([offer("marcus", 0), offer("elena", 0), offer("ana", 0, { careMinutes: 60 })], { careRateCentsPerHour: null })).parts[0]?.careValueCents).toBe(0);
  });

  it("refuses inputs that are not an ask: a cost of nothing, shares that do not total 10 000, a missing or doubled offer", () => {
    const good = [offer("marcus", 1), offer("elena", 1), offer("ana", 1)];
    expect(() => mediateQuietShare(stairlift(good, { costCents: 0 }))).toThrow(MediationError);
    expect(() => mediateQuietShare(stairlift(good, { costCents: 10.5 }))).toThrow();
    expect(() => mediateQuietShare(stairlift(good, { months: 4 }))).toThrow(MediationError);
    expect(() => mediateQuietShare(stairlift(good, { shares: [{ memberId: "marcus", bps: 5000 }, { memberId: "elena", bps: 3000 }, { memberId: "ana", bps: 1999 }] }))).toThrow(MediationError);
    expect(() => mediateQuietShare(stairlift(good.slice(1)))).toThrow(MediationError);
    expect(() => mediateQuietShare(stairlift([...good.slice(1), offer("elena", 2)]))).toThrow(MediationError);
  });
});

describe("a sealed offer", () => {
  it("holds whole cents in range, a step-up that is a later rise, care in range and a first month not before the ask's", () => {
    expect(checkSealedOffer(offer("a", 6_000, { stepUp: { cents: 15_000, fromMonth: "2026-12" }, careTrips: 2, careMinutes: 180 }), "2026-11")).toBeTruthy();
    const refused = (change: Partial<SealedOffer>, monthly = 6_000) => {
      try {
        checkSealedOffer(offer("a", monthly, change), "2026-11");
        return "accepted";
      } catch (error) {
        return error instanceof SealedOfferError ? error.reason : "other";
      }
    };
    expect(refused({}, -1)).toBe("amount");
    expect(refused({}, MAX_OFFER_CENTS + 1)).toBe("amount");
    expect(refused({}, 60.5)).toBe("other");
    expect(refused({ stepUp: { cents: 5_000, fromMonth: "2026-12" } })).toBe("step_up");
    expect(refused({ stepUp: { cents: 9_000, fromMonth: "2026-11" } })).toBe("step_up");
    expect(refused({ careMinutes: -5 })).toBe("care");
    expect(refused({ careTrips: 1.5 })).toBe("care");
    expect(refused({ earliestMonth: "2026-10" })).toBe("month");
    expect(refused({ earliestMonth: "2026-13" })).toBe("month");
  });

  it("counts months across a year's end", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-12", 0)).toBe("2026-12");
  });
});

describe("the ask and its parts", () => {
  it("only moves forward, and a plan, once agreed or withdrawn, is final", () => {
    expect(quietShareMayMove("gathering", "planned")).toBe(true);
    expect(quietShareMayMove("short", "planned")).toBe(true);
    expect(quietShareMayMove("planned", "agreed")).toBe(true);
    expect(quietShareMayMove("planned", "gathering")).toBe(false);
    expect(quietShareMayMove("planned", "short")).toBe(false);
    expect(quietShareMayMove("agreed", "withdrawn")).toBe(false);
    expect(QUIET_SHARE_TRANSITIONS.agreed).toEqual([]);
    expect(QUIET_SHARE_TRANSITIONS.withdrawn).toEqual([]);
  });

  it("says when a limit can be worked out: in a family of two, and when three or more fall short and compare their parts", () => {
    expect([1, 2, 3, 4].map((count) => limitsCanBeDeduced(count, "planned"))).toEqual([null, "pair", null, null]);
    expect([1, 2, 3, 4].map((count) => limitsCanBeDeduced(count, "short"))).toEqual([null, "pair", "comparing", "comparing"]);
    expect([2, 3].map((count) => limitsCanBeDeduced(count, "withdrawn"))).toEqual([null, null]);
  });

  it("pays a monthly rise by the monthly share, and a one-off by checkout, Pay Later or invoice", () => {
    expect(partMethods("monthly", { payLaterCents: 0 })).toEqual(["monthly_share"]);
    expect(partMethods("one_off", { payLaterCents: 0 })).toEqual(["checkout", "pay_later", "invoice"]);
    expect(partMethods("one_off", { payLaterCents: 100 })).toEqual(["pay_later"]);
  });
});

/** An ask of 1 to 6 people with random shares, offers and choices. */
function randomAsk(random: Random): MediationInput {
  const count = random.int(1, 6);
  const shares = randomShares(random, count);
  // Every person asked holds a share above zero: move a basis point to any that drew none.
  for (let index = 0; index < shares.length; index += 1) {
    if (shares[index] === 0) {
      const donor = shares.findIndex((bps) => bps > 1);
      shares[donor] = (shares[donor] ?? 0) - 1;
      shares[index] = 1;
    }
  }
  const startMonth = "2026-11";
  const ids = Array.from({ length: count }, (_, index) => `m-${random.int(0, 9999)}-${index}`);
  const big = random.pick([1_000, 100_000, 500_000]);
  return {
    costCents: random.int(1, random.pick([500, 90_000, 5_000_000])),
    startMonth,
    months: random.pick([1, SPREAD_MONTHS]),
    shares: ids.map((memberId, index) => ({ memberId, bps: shares[index] ?? 0 })),
    offers: ids.map((memberId) => {
      const monthlyCents = random.int(0, big);
      const step = random.int(0, 2) === 0 && monthlyCents < MAX_OFFER_CENTS ? { cents: random.int(monthlyCents + 1, MAX_OFFER_CENTS), fromMonth: random.pick(["2026-12", "2027-01"]) } : null;
      return offer(memberId, monthlyCents, {
        stepUp: step,
        careTrips: random.int(0, 3),
        careMinutes: random.int(0, 600),
        earliestMonth: random.pick([null, "2026-11", "2026-12", "2027-02"]),
        takesShortfall: random.int(0, 4) === 0,
      });
    }),
    careRateCentsPerHour: random.pick([null, 2500, 3333]),
  };
}

const capacity = (input: MediationInput, memberId: string): number => {
  const each = input.offers.find((one) => one.memberId === memberId);
  if (each === undefined) throw new Error("no offer");
  return Array.from({ length: input.months }, (_, index) => offerInMonth(each, addMonths(input.startMonth, index))).reduce((sum, cents) => sum + cents, 0);
};

describe("the mediator's properties, for any ask", () => {
  it("never asks anyone for more than they offered, except what they chose to take on with Pay Later", () => {
    forAll(randomAsk, (input) => {
      for (const part of mediateQuietShare(input).parts) {
        expect(part.cents - part.payLaterCents).toBeLessThanOrEqual(capacity(input, part.memberId));
        expect(part.cents - part.payLaterCents).toBeGreaterThanOrEqual(0);
        if (part.payLaterCents > 0) expect(input.offers.find((each) => each.memberId === part.memberId)?.takesShortfall).toBe(true);
      }
    });
  });

  it("covers the cost exactly, or reports the exact shortfall, with every part a whole number of cents", () => {
    forAll(randomAsk, (input) => {
      const result = mediateQuietShare(input);
      const total = result.parts.reduce((sum, part) => sum + part.cents, 0);
      expect(total + result.shortfallCents).toBe(input.costCents);
      expect(result.coveredCents).toBe(total);
      expect(result.shortfallCents).toBeGreaterThanOrEqual(0);
      for (const part of result.parts) {
        for (const cents of [part.cents, part.payLaterCents, part.shareCents, part.careValueCents, ...part.perMonth]) expect(Number.isSafeInteger(cents)).toBe(true);
        expect(part.perMonth).toHaveLength(input.months);
        expect(part.perMonth.reduce((sum, cents) => sum + cents, 0)).toBe(part.cents);
      }
    });
  });

  it("is short only when everyone is at their offer and nobody took the gap on", () => {
    forAll(randomAsk, (input) => {
      const result = mediateQuietShare(input);
      if (result.shortfallCents === 0) return;
      expect(input.offers.some((each) => each.takesShortfall)).toBe(false);
      for (const part of result.parts) expect(part.cents).toBe(capacity(input, part.memberId));
    });
  });

  it("gives the agreed shares exactly when no offer binds", () => {
    forAll(randomAsk, (input) => {
      const sorted = input.shares.toSorted((a, b) => (a.memberId < b.memberId ? -1 : 1));
      const targets = allocate(input.costCents, sorted.map((share) => share.bps));
      if (sorted.some((share, index) => capacity(input, share.memberId) < (targets[index] ?? 0))) return;
      expect(mediateQuietShare(input).parts.map((part) => part.cents)).toEqual(targets);
    });
  });

  it("when short, lets all but one who compare their parts work out the last one's limit, which is why the screen warns of it", () => {
    forAll(randomAsk, (input) => {
      const result = mediateQuietShare(input);
      if (result.shortfallCents === 0 || result.parts.length < 3) return;
      expect(limitsCanBeDeduced(result.parts.length, "short")).toBe("comparing");
      for (const part of result.parts) {
        const others = result.parts.filter((each) => each.memberId !== part.memberId).reduce((sum, each) => sum + each.cents, 0);
        expect(result.coveredCents - others).toBe(capacity(input, part.memberId));
      }
    });
  });

  it("does not depend on the order of the offers or of the shares, and gives the same answer every time", () => {
    forAll(
      (random) => ({ input: randomAsk(random), seed: random.int(1, 1_000_000) }),
      ({ input }) => {
        const once = mediateQuietShare(input);
        expect(mediateQuietShare(input)).toEqual(once);
        expect(mediateQuietShare({ ...input, offers: input.offers.toReversed(), shares: input.shares.toReversed() })).toEqual(once);
      },
    );
  });
});
