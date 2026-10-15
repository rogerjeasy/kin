import { planApprovals, rosesMonth } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { StoredPlanError, parseApprovalPlan } from "./plan-json.ts";

const now = new Date("2026-10-29T15:00:00Z");
const stored = (plan: unknown) => JSON.parse(JSON.stringify(plan)) as unknown;
const request = (cents: number, payee = { status: "new" as const, member: null, autoPay: null }) =>
  planApprovals({ kind: "bill_payment", cents, payee, agreement: rosesMonth.agreement, parentLevel: "decides", pausedUntil: null, now });

describe("a stored approval plan", () => {
  it("reads back as exactly the plan the approval engine made, for every outcome", () => {
    const plans = [
      request(90000),
      request(400000),
      planApprovals({ kind: "bill_payment", cents: 5700, payee: { status: "approved", member: null, autoPay: { ruleId: "gas", minCents: 4500, maxCents: 7000 } }, agreement: rosesMonth.agreement, parentLevel: "decides", pausedUntil: null, now }),
      planApprovals({ kind: "bill_payment", cents: 5700, payee: { status: "new", member: null, autoPay: null }, agreement: rosesMonth.agreement, parentLevel: "decides", pausedUntil: new Date("2026-10-30T00:00:00Z"), now }),
    ];
    expect(plans.map((plan) => plan.outcome)).toEqual(["needs_approval", "refused", "standing_rule", "paused"]);
    for (const plan of plans) expect(parseApprovalPlan(stored(plan))).toEqual(plan);
  });

  it.each([
    ["not an object", 42],
    ["an unknown outcome", { outcome: "approved" }],
    ["no slots", { ...stored(request(90000)) as object, slots: [] }],
    ["a role that does not exist", { ...stored(request(90000)) as object, slots: [{ reason: "organizer", roles: ["admin"] }] }],
    ["a date that is not one", { ...stored(request(90000)) as object, expiresAt: "soon" }],
    ["a payee that is not text", { ...stored(request(90000)) as object, payeeMemberId: 7 }],
  ])("is refused when it holds %s", (_, value) => {
    expect(() => parseApprovalPlan(value)).toThrow(StoredPlanError);
  });
});
