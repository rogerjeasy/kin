import { describe, expect, it } from "vitest";

import {
  FairnessError,
  calculateFairness,
  type FairnessInput,
  type MemberContribution,
} from "./fairness.ts";
import { InvalidMoneyError } from "./money.ts";
import { randomFairnessInput } from "./testing/generators.ts";
import { forAll } from "./testing/property.ts";

function member(
  memberId: string,
  shareBps: number,
  given: Partial<MemberContribution> = {},
): MemberContribution {
  return {
    memberId,
    shareBps,
    paidInCents: 0,
    outOfPocketCents: 0,
    careCreditCents: 0,
    carriedInCents: 0,
    ...given,
  };
}

function inputOf(
  members: MemberContribution[],
  careCreditPaidInCash = false,
): FairnessInput {
  return { currency: "USD", careCreditPaidInCash, members };
}

function positionsOf(input: FairnessInput): Record<string, number> {
  return Object.fromEntries(
    calculateFairness(input).positions.map((position) => [
      position.memberId,
      position.positionCents,
    ]),
  );
}

const total = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0);

describe("calculateFairness", () => {
  it("finds everyone level when each paid exactly their share", () => {
    const input = inputOf([
      member("marcus", 5000, { paidInCents: 50000 }),
      member("elena", 3000, { paidInCents: 30000 }),
      member("ana", 2000, { paidInCents: 20000 }),
    ]);

    expect(positionsOf(input)).toEqual({ marcus: 0, elena: 0, ana: 0 });
  });

  it("owes a member the others' share of what she paid from her own pocket", () => {
    const input = inputOf([
      member("marcus", 5000, { paidInCents: 50000 }),
      member("elena", 3000, { paidInCents: 30000, outOfPocketCents: 18000 }),
      member("ana", 2000, { paidInCents: 20000 }),
    ]);

    // Elena carries 30 percent of her own 180.00, so 126.00 comes back.
    expect(positionsOf(input)).toEqual({ marcus: -9000, elena: 12600, ana: -3600 });
  });

  it("lets care hours lower the cash a member owes", () => {
    const result = calculateFairness(
      inputOf([
        member("marcus", 5000, { paidInCents: 50000 }),
        member("ana", 5000, { paidInCents: 30000, careCreditCents: 20000 }),
      ]),
    );

    expect(result.totalContributedCents).toBe(100000);
    expect(result.positions).toEqual([
      {
        memberId: "ana",
        contributedCents: 50000,
        targetCents: 50000,
        cashDueCents: 30000,
        unusedCareCreditCents: 0,
        positionCents: 0,
      },
      {
        memberId: "marcus",
        contributedCents: 50000,
        targetCents: 50000,
        cashDueCents: 50000,
        unusedCareCreditCents: 0,
        positionCents: 0,
      },
    ]);
  });

  it("does not pay care credit out in cash by default", () => {
    const result = calculateFairness(
      inputOf([
        member("marcus", 5000, { paidInCents: 20000 }),
        member("ana", 5000, { careCreditCents: 60000 }),
      ]),
    );
    const [ana, marcus] = result.positions;

    // Ana's target is 400.00. Her 600.00 of care covers it and no more.
    expect(ana).toMatchObject({
      targetCents: 40000,
      cashDueCents: 0,
      unusedCareCreditCents: 20000,
      positionCents: 0,
    });
    expect(marcus).toMatchObject({ targetCents: 40000, positionCents: -20000 });
  });

  it("pays care credit out when the agreement switches that on", () => {
    const input = inputOf(
      [
        member("marcus", 5000, { paidInCents: 20000 }),
        member("ana", 5000, { careCreditCents: 60000 }),
      ],
      true,
    );
    const [ana] = calculateFairness(input).positions;

    expect(positionsOf(input)).toEqual({ marcus: -20000, ana: 20000 });
    expect(ana).toMatchObject({ cashDueCents: -20000, unusedCareCreditCents: 0 });
  });

  it("adds the balance carried in from the last period", () => {
    const input = inputOf([
      member("marcus", 5000, { paidInCents: 50000, carriedInCents: -16600 }),
      member("elena", 5000, { paidInCents: 50000, carriedInCents: 12600 }),
    ]);

    expect(positionsOf(input)).toEqual({ marcus: -16600, elena: 12600 });
  });

  it("counts a refund that outweighs a member's payments", () => {
    const input = inputOf([
      member("marcus", 5000, { paidInCents: -10000 }),
      member("elena", 5000, { paidInCents: 30000 }),
    ]);

    expect(positionsOf(input)).toEqual({ marcus: -20000, elena: 20000 });
  });

  it("gives a tied leftover cent to the member whose ID sorts first", () => {
    // 0.01 split half and half leaves the same half cent for both members.
    const result = calculateFairness(
      inputOf([member("b", 5000, { paidInCents: 1 }), member("a", 5000)]),
    );

    expect(
      result.positions.map(({ memberId, targetCents }) => [memberId, targetCents]),
    ).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
  });

  it("refuses shares that do not total 10,000 basis points", () => {
    expect(() =>
      calculateFairness(inputOf([member("a", 5000), member("b", 4999)])),
    ).toThrow(FairnessError);
    expect(() =>
      calculateFairness(inputOf([member("a", 10001), member("b", -1)])),
    ).toThrow(FairnessError);
    expect(() =>
      calculateFairness(inputOf([member("a", 5000.5), member("b", 4999.5)])),
    ).toThrow(FairnessError);
  });

  it("refuses an empty circle or a member listed twice", () => {
    expect(() => calculateFairness(inputOf([]))).toThrow(FairnessError);
    expect(() =>
      calculateFairness(inputOf([member("a", 5000), member("a", 5000)])),
    ).toThrow(FairnessError);
  });

  it("refuses amounts that cannot be right", () => {
    const withGiven = (given: Partial<MemberContribution>) =>
      inputOf([member("a", 10000, given)]);

    expect(() =>
      calculateFairness(withGiven({ paidInCents: 100.5 })),
    ).toThrow(InvalidMoneyError);
    expect(() =>
      calculateFairness(withGiven({ outOfPocketCents: -1 })),
    ).toThrow(FairnessError);
    expect(() =>
      calculateFairness(withGiven({ careCreditCents: -1 })),
    ).toThrow(FairnessError);
    expect(() =>
      calculateFairness(withGiven({ paidInCents: -1 })),
    ).toThrow(FairnessError);
  });
});

describe("for any contributions and shares", () => {
  it("targets total the contributions exactly", () => {
    forAll(randomFairnessInput, (input) => {
      const result = calculateFairness(input);
      const given = input.members.map(
        (each) =>
          each.paidInCents + each.outOfPocketCents + each.careCreditCents,
      );

      expect(result.totalContributedCents).toBe(total(given));
      expect(
        total(result.positions.map((position) => position.targetCents)),
      ).toBe(result.totalContributedCents);
    });
  });

  it("positions total what was carried in, less care credit that earned no cash", () => {
    forAll(randomFairnessInput, (input) => {
      const { positions } = calculateFairness(input);
      const carriedIn = total(input.members.map((each) => each.carriedInCents));
      const unused = total(
        positions.map((position) => position.unusedCareCreditCents),
      );

      expect(total(positions.map((position) => position.positionCents))).toBe(
        carriedIn - unused,
      );
      if (input.careCreditPaidInCash) {
        expect(unused).toBe(0);
      }
    });
  });

  it("the order the members are given in does not matter", () => {
    forAll(
      (random) => {
        const input = randomFairnessInput(random);
        return { input, shuffled: random.shuffle(input.members) };
      },
      ({ input, shuffled }) => {
        expect(calculateFairness({ ...input, members: shuffled })).toEqual(
          calculateFairness(input),
        );
      },
    );
  });

  it("a member with no share and no contribution owes and is owed nothing", () => {
    forAll(randomFairnessInput, (input) => {
      const bystander = member("bystander", 0);
      const { positions } = calculateFairness({
        ...input,
        members: [...input.members, bystander],
      });

      expect(
        positions.find((position) => position.memberId === "bystander"),
      ).toMatchObject({ targetCents: 0, cashDueCents: 0, positionCents: 0 });
    });
  });
});
