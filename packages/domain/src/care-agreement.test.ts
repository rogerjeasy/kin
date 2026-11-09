import { describe, expect, it } from "vitest";

import {
  CareAgreementGateError,
  CareAgreementTermsError,
  assertWorkCovered,
  careAgreementClauses,
  careAgreementStatus,
  checkCareAgreementTerms,
  coveredFrom,
  replacedBy,
  signedAfterStart,
  workCoverage,
  type CareAgreementFacts,
  type CareAgreementTerms,
} from "./care-agreement.ts";

const terms: CareAgreementTerms = {
  payeeId: "payee-1",
  caregiverMemberId: "member-1",
  caregiverRelation: "child",
  duties: ["Cook meals", "Drive to appointments"],
  weeklyMinutes: 20 * 60,
  rateCentsPerHour: 3000,
  startsOn: "2026-10-01",
  endTerm: "either_party_30_days",
  endsOn: null,
  payer: "care_recipient",
  state: "NY",
};

const facts = (overrides: Partial<CareAgreementFacts> = {}): CareAgreementFacts => ({
  id: "a-1",
  payeeId: "payee-1",
  state: "draft",
  rateCentsPerHour: 3000,
  startsOn: "2026-10-01",
  endTerm: "either_party_30_days",
  endsOn: null,
  endedOn: null,
  signatures: [
    { memberId: "member-1", capacity: "caregiver", signedOn: "2026-09-28" },
    { memberId: "member-2", capacity: "care_recipient", signedOn: "2026-09-29" },
  ],
  ...overrides,
});

describe("checking the terms", () => {
  it("accepts a complete agreement", () => {
    expect(checkCareAgreementTerms(terms).duties).toEqual(["Cook meals", "Drive to appointments"]);
  });

  it("refuses an agreement with a spouse, with its own reason", () => {
    expect(() => checkCareAgreementTerms({ ...terms, caregiverRelation: "spouse" })).toThrow(expect.objectContaining({ reason: "spouse" }));
  });

  it.each([
    ["duties", { duties: [] }],
    ["duties", { duties: ["x".repeat(201)] }],
    ["hours", { weeklyMinutes: 0 }],
    ["hours", { weeklyMinutes: 85 * 60 }],
    ["rate", { rateCentsPerHour: 0 }],
    ["rate", { rateCentsPerHour: 30.5 }],
    ["start_date", { startsOn: "2026-02-30" }],
    ["end_date", { endTerm: "fixed_end_date" as const, endsOn: null }],
    ["end_date", { endTerm: "fixed_end_date" as const, endsOn: "2026-09-01" }],
    ["end_date", { endsOn: "2027-01-01" }],
    ["state", { state: "ZZ" as never }],
  ] as const)("refuses %s", (reason, change) => {
    expect(() => checkCareAgreementTerms({ ...terms, ...change })).toThrow(new CareAgreementTermsError(reason));
  });
});

describe("what an agreement covers", () => {
  it("covers work from the later of its start and its last signature, never earlier", () => {
    expect(coveredFrom(facts())).toBe("2026-10-01");
    const late = facts({ signatures: [{ memberId: "member-1", capacity: "caregiver", signedOn: "2026-10-05" }, { memberId: "member-2", capacity: "representative", signedOn: "2026-10-03" }] });
    expect(coveredFrom(late)).toBe("2026-10-05");
    expect(signedAfterStart(late)).toBe(true);
    expect(workCoverage("2026-10-04", [late], 3000)).toEqual({ kind: "not_covered", reason: "before_signed" });
    expect(workCoverage("2026-10-05", [late], 3000)).toEqual({ kind: "covered", agreementId: "a-1" });
  });

  it("covers nothing until the caregiver and the care recipient's side have both signed", () => {
    const half = facts({ signatures: [{ memberId: "member-1", capacity: "caregiver", signedOn: "2026-09-28" }] });
    expect(coveredFrom(half)).toBeNull();
    expect(careAgreementStatus(half, "2026-10-10")).toBe("draft");
    expect(workCoverage("2026-10-10", [half], 3000)).toEqual({ kind: "not_covered", reason: "unsigned" });
  });

  it("stops at the end day, whichever of the fixed end and the early end comes first", () => {
    const ended = facts({ endTerm: "fixed_end_date", endsOn: "2026-12-31", endedOn: "2026-11-30" });
    expect(workCoverage("2026-11-30", [ended], 3000).kind).toBe("covered");
    expect(workCoverage("2026-12-01", [ended], 3000)).toEqual({ kind: "not_covered", reason: "after_end" });
    expect(careAgreementStatus(ended, "2026-12-15")).toBe("ended");
    expect(careAgreementStatus(facts(), "2026-09-30")).toBe("scheduled");
    expect(careAgreementStatus(facts(), "2026-10-02")).toBe("active");
  });

  it("is undocumented, not refused, for a caregiver with no agreement, and ignores withdrawn ones", () => {
    expect(workCoverage("2026-10-10", [], 3000)).toEqual({ kind: "undocumented" });
    expect(workCoverage("2026-10-10", [facts({ state: "withdrawn" })], 3000)).toEqual({ kind: "undocumented" });
    expect(() => assertWorkCovered(["2026-10-10"], [], 3000)).not.toThrow();
  });

  it("refuses a payout naming any uncovered day, and names the first", () => {
    expect(() => assertWorkCovered(["2026-10-09", "2026-09-30", "2026-10-02"], [facts()], 3000)).toThrow(new CareAgreementGateError("before_signed", "2026-09-30"));
  });

  it("covers a day only at the rate the agreement states, so pay at a changed rate waits for a new agreement", () => {
    expect(workCoverage("2026-10-10", [facts()], 3000)).toEqual({ kind: "covered", agreementId: "a-1" });
    expect(workCoverage("2026-10-10", [facts()], 3500)).toEqual({ kind: "not_covered", reason: "rate_differs" });
    expect(() => assertWorkCovered(["2026-10-10"], [facts()], 2200)).toThrow(new CareAgreementGateError("rate_differs", "2026-10-10"));
    // A rate the record does not know judges the day alone.
    expect(workCoverage("2026-10-10", [facts()], null)).toEqual({ kind: "covered", agreementId: "a-1" });
    // A day no agreement covers says why, whatever the rate.
    expect(workCoverage("2026-09-20", [facts()], 3500)).toEqual({ kind: "not_covered", reason: "before_signed" });
  });

  it("finds the agreement at the paid rate when an old and a new one both name the day", () => {
    const old = facts({ id: "old", endedOn: "2026-11-08" });
    const raise = facts({ id: "new", rateCentsPerHour: 3500, startsOn: "2026-11-09", signatures: [{ memberId: "member-1", capacity: "caregiver", signedOn: "2026-11-09" }, { memberId: "member-2", capacity: "representative", signedOn: "2026-11-09" }] });
    expect(workCoverage("2026-11-08", [old, raise], 3000)).toEqual({ kind: "covered", agreementId: "old" });
    expect(workCoverage("2026-11-09", [old, raise], 3500)).toEqual({ kind: "covered", agreementId: "new" });
    expect(workCoverage("2026-11-09", [old, raise], 3000)).toEqual({ kind: "not_covered", reason: "rate_differs" });
  });
});

describe("an agreement replaced by a newer one", () => {
  const signedOn = (day: string) => [
    { memberId: "member-1", capacity: "caregiver" as const, signedOn: day },
    { memberId: "member-2", capacity: "representative" as const, signedOn: day },
  ];

  it("names the newer agreement that began the day after the old one ended", () => {
    const old = facts({ id: "old", endedOn: "2026-11-08" });
    const raise = facts({ id: "new", startsOn: "2026-11-09", signatures: signedOn("2026-11-09") });
    expect(replacedBy(old, [old, raise])?.id).toBe("new");
    expect(replacedBy(raise, [old, raise])).toBeNull();
  });

  it("is not replaced when it was ended by hand, by a withdrawn draft, or by another caregiver's agreement", () => {
    const old = facts({ id: "old", endedOn: "2026-11-08" });
    expect(replacedBy(old, [old])).toBeNull();
    expect(replacedBy(old, [old, facts({ id: "w", state: "withdrawn", startsOn: "2026-11-09", signatures: signedOn("2026-11-09") })])).toBeNull();
    expect(replacedBy(old, [old, facts({ id: "x", payeeId: "payee-2", startsOn: "2026-11-09", signatures: signedOn("2026-11-09") })])).toBeNull();
    expect(replacedBy(facts({ id: "open" }), [facts({ id: "open" })])).toBeNull();
  });

  it("crosses a month and a year end", () => {
    const old = facts({ id: "old", endedOn: "2026-12-31" });
    const next = facts({ id: "new", startsOn: "2027-01-01", signatures: signedOn("2026-12-20") });
    expect(replacedBy(old, [old, next])?.id).toBe("new");
  });
});

describe("the template", () => {
  const names = { caregiver: "Maya", careRecipient: "Rose", rate: "$30.00", day: (iso: string) => iso };
  const text = careAgreementClauses(terms, names).flatMap((clause) => [clause.heading, ...clause.body]).join("\n");

  it("fills the family's facts into fixed wording", () => {
    expect(text).toContain("Maya");
    expect(text).toContain("$30.00 for each hour");
    expect(text).toContain("about 20 hours a week");
    expect(text).toContain("1. Cook meals");
    expect(text).toContain("state of NY");
  });

  it("never calls the agreement safe or says it is legal advice", () => {
    expect(text).not.toMatch(/medicaid[- ]safe|compliant|protected/iu);
    expect(text).toContain("not a gift");
  });
});
