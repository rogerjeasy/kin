import { describe, expect, it } from "vitest";

import { BASIS_POINTS } from "./agreement.ts";
import { rosesMonth } from "./examples/roses-month.ts";
import { FairnessError } from "./fairness.ts";
import { settlePeriod } from "./settle-period.ts";
import { simulateScenario, type Scenario } from "./simulate.ts";
import { forAll } from "./testing/index.ts";

const NOW = new Date("2026-10-14T12:00:00Z");
const run = (scenario: Scenario) => simulateScenario({ ...rosesMonth, scenario, parentLevel: "decides", pausedUntil: null, now: NOW });

describe("simulateScenario", () => {
  it("with nothing changed, gives the real settlement twice", () => {
    const result = run({});
    expect(result.before).toEqual(settlePeriod(rosesMonth));
    expect(result.after).toEqual(result.before);
    expect(result.changes).toEqual([]);
    expect(result.bill).toBeNull();
  });

  it("moves each member's target when the shares change", () => {
    const result = run({ shares: [{ memberId: "marcus", bps: 4000 }, { memberId: "elena", bps: 3000 }, { memberId: "ana", bps: 3000 }] });
    const target = (memberId: string) => result.after.fairness.positions.find((position) => position.memberId === memberId)?.targetCents;
    expect(target("ana")).toBe(35400);
    expect(result.changes).toHaveLength(2);
  });

  it("refuses shares that do not total 10 000, as the real calculation does", () => {
    expect(() => run({ shares: [{ memberId: "marcus", bps: 5000 }, { memberId: "elena", bps: 3000 }, { memberId: "ana", bps: 3000 }] })).toThrow(FairnessError);
  });

  it("spreads a leaving member's share over the rest in proportion", () => {
    const result = run({ leavingMemberId: "marcus" });
    expect(result.agreement.shares).toEqual([
      { memberId: "marcus", bps: 0 },
      { memberId: "elena", bps: 6000 },
      { memberId: "ana", bps: 4000 },
    ]);
    expect(result.changes).toContainEqual({ kind: "share", memberId: "marcus", fromBps: 5000, toBps: null });
  });

  it("asks the real approval engine about a bill and shares any shortfall to the cent", () => {
    const result = run({ billCents: 90000 });
    expect(result.bill?.approval.outcome).toBe("needs_approval");
    expect(result.bill?.topUps.reduce((sum, part) => sum + part.cents, 0)).toBe(result.bill?.shortfallCents);
    expect(run({ billCents: 400000 }).bill?.approval).toEqual({ outcome: "refused", reason: "above_ceiling" });
  });

  it("keeps hypothetical shares at 10 000 and the shortfall exact for any leaver and bill", () => {
    forAll(
      (random) => ({ leaver: random.pick(["marcus", "elena", "ana"]), bill: random.int(1, 1_000_000) }),
      ({ leaver, bill }) => {
        const result = run({ leavingMemberId: leaver, billCents: bill });
        expect(result.agreement.shares.reduce((sum, share) => sum + share.bps, 0)).toBe(BASIS_POINTS);
        expect(result.bill?.topUps.reduce((sum, part) => sum + part.cents, 0)).toBe(result.bill?.shortfallCents);
      },
    );
  });
});
