import { asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { describe, expect, it } from "vitest";

import { runAgreement, sharingMembers } from "./agreement";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle): Promise<CircleSnapshot> => asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
const draft = (circle: VisitorCircle, change: Record<string, unknown> = {}) => ({
  shares: [{ memberId: circle.members.marcus, percent: "45" }, { memberId: circle.members.elena, percent: "30" }, { memberId: circle.members.ana, percent: "25" }],
  care: { rate: "20.00", paidInCash: false },
  approvals: { parent: "50.00", second: "400", ceiling: "3000.00" },
  effectiveOn: "2026-10-30",
  ...change,
});
const run = async (circle: VisitorCircle, input: unknown) => runAgreement({ db: db.app, userId: circle.userId, circle: await snapshot(circle) }, input);

describe("the agreement at the untrusted request boundary", () => {
  it("reviews a draft without storing anything, and says exactly what changes", async () => {
    const circle = await visitorWithCircle(db);
    const review = await run(circle, { operation: "review", draft: draft(circle) });
    expect(review).toMatchObject({ ok: true, terms: { approvals: { secondApprovalAboveCents: 40_000 } } });
    expect("changes" in review && review.changes.map((change) => change.kind)).toEqual(["share", "share", "threshold"]);
    expect((await snapshot(circle)).agreementVersions).toHaveLength(1);
  });

  it("proposes, and lets the members who share the cost accept until it governs", async () => {
    const circle = await visitorWithCircle(db);
    const proposed = await run(circle, { operation: "propose", draft: draft(circle) });
    if (!proposed.ok || !("id" in proposed)) throw new Error("Expected a proposal");
    for (const persona of ["marcus", "ana"] as const) {
      await as(circle, persona);
      expect(await run(circle, { operation: "accept", agreementId: proposed.id })).toEqual({ ok: true, id: proposed.id });
    }
    expect((await snapshot(circle)).agreement?.version).toBe(2);
  });

  it("names the rule a draft breaks, reading amounts and percentages digit by digit", async () => {
    const circle = await visitorWithCircle(db);
    const cases: [Record<string, unknown>, string][] = [
      [{ shares: [{ memberId: circle.members.marcus, percent: "99.999" }] }, "share"],
      [{ shares: [{ memberId: circle.members.marcus, percent: "90" }] }, "shares_total"],
      [{ shares: [{ memberId: circle.members.amara, percent: "100" }] }, "share_member"],
      [{ approvals: { parent: "50", second: "4000", ceiling: "3000" } }, "threshold_above_ceiling"],
      [{ approvals: { parent: "1e3", second: "400", ceiling: "3000" } }, "amount"],
      [{ effectiveOn: "2026-10-29" }, "effective_date"],
      [{ care: { rate: "0", paidInCash: false } }, "care_rate"],
    ];
    for (const [change, reason] of cases) expect(await run(circle, { operation: "review", draft: draft(circle, change) })).toEqual({ ok: false, reason });
  });

  it("refuses forged and extra fields, and every role but the organizer's for proposing", async () => {
    const circle = await visitorWithCircle(db);
    for (const input of [
      { operation: "review", draft: { ...draft(circle), version: 9 } },
      { operation: "review", draft: draft(circle), bps: 10_000 },
      { operation: "review", draft: draft(circle, { shares: [{ memberId: circle.members.marcus, bps: 10_000 }] }) },
      { operation: "accept", agreementId: "not-an-id" },
      { operation: "approve" },
      "review",
    ]) {
      expect(await run(circle, input)).toEqual({ ok: false, reason: "invalid" });
    }
    for (const persona of ["marcus", "rose", "daniel", "amara"] as const) {
      await as(circle, persona);
      expect(await run(circle, { operation: "propose", draft: draft(circle) })).toEqual({ ok: false, reason: "refused" });
    }
    await as(circle, "daniel");
    expect(await run(circle, { operation: "accept", agreementId: crypto.randomUUID() })).toEqual({ ok: false, reason: "refused" });
  });

  it("offers shares to the members who share the cost, in the agreement's own order", async () => {
    const circle = await visitorWithCircle(db);
    expect(sharingMembers(await snapshot(circle))).toEqual([circle.members.marcus, circle.members.elena, circle.members.ana]);
  });
});
