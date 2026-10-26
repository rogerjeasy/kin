import { describe, expect, it } from "vitest";

import { AgreementTermsError, agreementChanges, agreementStanding, bpsFromPercent, checkAgreementTerms, percentFromBps, type AgreementTerms, type VersionFacts } from "./agreement-terms.ts";
import { forAll } from "./testing/property.ts";

const today = "2026-10-26";
const sharing = ["marcus", "elena", "ana"];
const roses: AgreementTerms = {
  shares: [{ memberId: "marcus", bps: 5000 }, { memberId: "elena", bps: 3000 }, { memberId: "ana", bps: 2000 }],
  care: { rateCentsPerHour: 2000, paidInCash: false },
  approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 50_000, parentDecidesAboveCents: 5_000 },
  effectiveOn: today,
};
const check = (terms: Partial<AgreementTerms>) => checkAgreementTerms({ ...roses, ...terms }, { today, sharingMemberIds: sharing });
const reason = (terms: Partial<AgreementTerms>) => {
  try {
    check(terms);
    return "accepted";
  } catch (error) {
    if (error instanceof AgreementTermsError) return error.reason;
    throw error;
  }
};

describe("checking an agreement's terms", () => {
  it("accepts Rose's family's terms as written", () => {
    expect(check({})).toEqual(roses);
  });

  it("refuses shares that are missing, not whole, from someone who does not share the cost, repeated, or not totalling 100%", () => {
    expect(reason({ shares: [] })).toBe("no_shares");
    expect(reason({ shares: [{ memberId: "marcus", bps: 10_000.5 }] })).toBe("share");
    expect(reason({ shares: [{ memberId: "marcus", bps: 0 }, { memberId: "elena", bps: 10_000 }] })).toBe("share");
    expect(reason({ shares: [{ memberId: "amara", bps: 10_000 }] })).toBe("share_member");
    expect(reason({ shares: [{ memberId: "marcus", bps: 5000 }, { memberId: "marcus", bps: 5000 }] })).toBe("duplicate_member");
    expect(reason({ shares: [{ memberId: "marcus", bps: 5000 }, { memberId: "elena", bps: 4999 }] })).toBe("shares_total");
  });

  it("refuses a ceiling of nothing, negative amounts, and thresholds above the ceiling", () => {
    expect(reason({ approvals: { ...roses.approvals, ceilingCents: 0, secondApprovalAboveCents: 0, parentDecidesAboveCents: 0 } })).toBe("ceiling");
    expect(reason({ approvals: { ...roses.approvals, parentDecidesAboveCents: -1 } })).toBe("threshold");
    expect(reason({ approvals: { ...roses.approvals, secondApprovalAboveCents: 300_001 } })).toBe("threshold_above_ceiling");
    expect(reason({ approvals: { ...roses.approvals, parentDecidesAboveCents: 300_001 } })).toBe("threshold_above_ceiling");
    // A threshold equal to the ceiling is allowed: an amount equal to a threshold does not cross it.
    expect(reason({ approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 300_000, parentDecidesAboveCents: 0 } })).toBe("accepted");
  });

  it("needs a positive care rate when care counts, and a start that is a real day, today or later", () => {
    expect(reason({ care: { rateCentsPerHour: 0, paidInCash: false } })).toBe("care_rate");
    expect(reason({ care: null })).toBe("accepted");
    expect(reason({ effectiveOn: "2026-10-25" })).toBe("effective_date");
    expect(reason({ effectiveOn: "2026-02-30" })).toBe("effective_date");
    expect(reason({ effectiveOn: "2026-11-01" })).toBe("accepted");
  });
});

describe("shares typed as percentages", () => {
  it("reads whole and two-decimal percentages exactly, with a point or a comma", () => {
    expect([bpsFromPercent("50"), bpsFromPercent("33.33"), bpsFromPercent("12,5"), bpsFromPercent(" 0.01 "), bpsFromPercent("100")]).toEqual([5000, 3333, 1250, 1, 10_000]);
  });

  it("refuses what is not a share", () => {
    for (const text of ["", "0", "0.00", "100.01", "101", "33.333", "-5", "1e2", "abc", "50%"]) {
      expect(() => bpsFromPercent(text), text).toThrow(AgreementTermsError);
    }
  });

  it("gives back exactly the share it read, for every possible share", () => {
    forAll(
      (random) => random.int(1, 10_000),
      (bps) => expect(bpsFromPercent(percentFromBps(bps))).toBe(bps),
    );
  });
});

describe("which version governs", () => {
  const version = (version: number, accepted: readonly string[], effectiveOn = "2026-10-01"): VersionFacts => ({ version, effectiveOn, requiredMemberIds: sharing, acceptedMemberIds: accepted });

  it("is the newest version every member with a share has accepted", () => {
    const standing = agreementStanding([version(1, sharing), version(2, ["elena"])], today);
    expect(standing.inForce).toBe(1);
    expect(Object.fromEntries(standing.statuses)).toEqual({ 1: "in_force", 2: "awaiting" });
    expect(standing.waitingFor.get(2)).toEqual(["marcus", "ana"]);
  });

  it("moves to the new version once the last member accepts, and the old one becomes earlier", () => {
    const standing = agreementStanding([version(1, sharing), version(2, [...sharing, "rose"])], today);
    expect(Object.fromEntries(standing.statuses)).toEqual({ 1: "earlier", 2: "in_force" });
  });

  it("waits for a start date in the future, and calls a replaced proposal superseded", () => {
    const standing = agreementStanding([version(1, sharing), version(2, ["elena"]), version(3, sharing, "2026-11-01")], today);
    expect(standing.inForce).toBe(1);
    expect(Object.fromEntries(standing.statuses)).toEqual({ 1: "in_force", 2: "superseded", 3: "scheduled" });
    expect(standing.waitingFor.size).toBe(0);
  });

  it("has nothing in force before any version is accepted", () => {
    expect(agreementStanding([], today).inForce).toBeNull();
    expect(agreementStanding([version(1, ["elena"])], today)).toMatchObject({ inForce: null, statuses: new Map([[1, "awaiting"]]) });
  });

  it("is always fully accepted and already started, and every newer version is not both", () => {
    forAll(
      (random) =>
        Array.from({ length: random.int(1, 6) }, (_, index) =>
          version(index + 1, sharing.filter(() => random.int(0, 3) > 0), random.pick(["2026-10-01", today, "2026-11-01"] as const)),
        ),
      (versions) => {
        const { inForce } = agreementStanding(versions, today);
        const governs = (each: VersionFacts) => sharing.every((member) => each.acceptedMemberIds.includes(member)) && each.effectiveOn <= today;
        if (inForce !== null) expect(governs(versions[inForce - 1] as VersionFacts)).toBe(true);
        expect(versions.filter((each) => each.version > (inForce ?? 0)).some(governs)).toBe(false);
      },
    );
  });
});

describe("what a new version changes", () => {
  it("names each changed share, a member who no longer shares, the care terms and each approval amount", () => {
    const next = {
      shares: [{ memberId: "marcus", bps: 4500 }, { memberId: "elena", bps: 3000 }, { memberId: "ana", bps: 2500 }],
      care: { rateCentsPerHour: 2200, paidInCash: true },
      approvals: { ...roses.approvals, secondApprovalAboveCents: 40_000 },
    };
    expect(agreementChanges(roses, next)).toEqual([
      { kind: "share", memberId: "marcus", fromBps: 5000, toBps: 4500 },
      { kind: "share", memberId: "ana", fromBps: 2000, toBps: 2500 },
      { kind: "care_rate", fromCents: 2000, toCents: 2200 },
      { kind: "care_cash", to: true },
      { kind: "threshold", which: "second", fromCents: 50_000, toCents: 40_000 },
    ]);
    expect(agreementChanges(roses, { ...roses, shares: [{ memberId: "marcus", bps: 10_000 }] })).toEqual([
      { kind: "share", memberId: "marcus", fromBps: 5000, toBps: 10_000 },
      { kind: "share", memberId: "elena", fromBps: 3000, toBps: null },
      { kind: "share", memberId: "ana", fromBps: 2000, toBps: null },
    ]);
  });

  it("lists every term of a first agreement, and nothing for an unchanged one", () => {
    expect(agreementChanges(null, roses).map((change) => change.kind)).toEqual(["share", "share", "share", "care_rate", "threshold", "threshold", "threshold"]);
    expect(agreementChanges(roses, roses)).toEqual([]);
  });
});
