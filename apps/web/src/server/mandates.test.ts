import { asPerson, readCircle, type CircleSnapshot } from "@kin/db";
import { seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import { mandateViews } from "@/content/circle/mandates";

import { runMandate, type MandateContext } from "./mandates";
import { runRefill } from "./refills";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> =>
  asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date("2026-10-30T18:00:00Z") }));
const context = (circle: CircleSnapshot, userId: string): MandateContext => ({ db: db.app, userId, circle });
const draft = (circle: CircleSnapshot, change: Record<string, unknown> = {}) => ({
  ruleId: circle.purchaseRules[0]?.id,
  perPurchase: "60.00",
  perPeriod: "60.00",
  cadence: "monthly",
  validFrom: "2026-10-30",
  expiresOn: "2027-03-31",
  ...change,
});

describe("recording a standing permission", () => {
  it("reads the terms back without storing anything, then records them once the yes is given, simulated in the demo", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);

    const review = await runMandate(context(seen, circle.userId), { operation: "review", draft: draft(seen) });
    expect(review).toMatchObject({ ok: true, terms: { perPurchaseCents: 6000, perPeriodCents: 6000, cadence: "monthly" } });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from mandates where circle_id = $1", [circle.circleId])).toEqual([{ n: 1 }]);

    const granted = await runMandate(context(seen, circle.userId), { operation: "grant", draft: draft(seen), spokenText: "Sixty dollars a month, no more." });
    expect(granted).toMatchObject({ ok: true });
    const views = mandateViews(await snapshot(circle, circle.userId));
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ item: "Monthly prescription refill (30 days)", canEnd: true, mandate: { perPurchaseCents: 6000, simulated: true, spokenText: "Sixty dollars a month, no more." } });
  });

  it("takes only the form's fields, a rule of this circle, and plain amounts", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const run = (input: unknown) => runMandate(context(seen, circle.userId), input);
    for (const forged of [
      null,
      { operation: "grant" },
      { operation: "grant", draft: draft(seen, { ruleId: "7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f" }) },
      { operation: "grant", draft: draft(seen, { status: "active" }) },
      { operation: "grant", draft: draft(seen, { cadence: "daily" }) },
      { operation: "grant", draft: draft(seen), digest: "x" },
      { operation: "review", draft: draft(seen), spokenText: "x" },
      { operation: "nothing" },
    ]) {
      expect(await run(forged)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await run({ operation: "grant", draft: draft(seen, { perPurchase: "sixty" }) })).toEqual({ ok: false, reason: "amount" });
    expect(await run({ operation: "grant", draft: draft(seen, { perPurchase: "9999.00", perPeriod: "9999.00" }) })).toEqual({ ok: false, reason: "above_ceiling" });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from mandates where circle_id = $1", [circle.circleId])).toEqual([{ n: 1 }]);
  });

  it("is refused to a contributor, an observer and a caregiver, though a contributor may pause one", async () => {
    const circle = await visitorWithCircle(db);
    const mandateId = String((await serviceRows(db, circle.circleId, "select id from mandates where circle_id = $1", [circle.circleId]))[0]?.id);
    for (const persona of ["marcus", "daniel", "amara"] as const) {
      const userId = await seatPerson(db, circle.circleId, circle.members[persona]);
      const seen = await snapshot(circle, userId);
      expect(await runMandate(context(seen, userId), { operation: "grant", draft: draft(seen) })).toEqual({ ok: false, reason: "refused" });
      expect(await runMandate(context(seen, userId), { operation: "revoke", mandateId })).toEqual({ ok: false, reason: "refused" });
    }
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    expect(await runMandate(context(await snapshot(circle, marcus), marcus), { operation: "pause", mandateId })).toEqual({ ok: true, id: mandateId });
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    expect(await runMandate(context(await snapshot(circle, daniel), daniel), { operation: "pause", mandateId })).toEqual({ ok: false, reason: "refused" });
  });
});

describe("a refill under the standing permission", () => {
  it("is bought without asking Rose, and the same request later says why when it falls outside", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const ruleId = seen.purchaseRules[0]?.id;
    const first = await runRefill({ db: db.app, userId: circle.userId, circle: seen }, { ruleId });
    expect(first).toMatchObject({ ok: true, mandate: { outcome: "covered" } });
    expect(await serviceRows(db, circle.circleId, "select state from proposals where kind = 'purchase' and circle_id = $1", [circle.circleId])).toEqual([{ state: "approved" }]);

    // The month's one purchase is used, so a second asks Rose and says why.
    await serviceRows(db, circle.circleId, "update proposals set state = 'executing' where kind = 'purchase' and circle_id = $1", [circle.circleId]);
    await serviceRows(db, circle.circleId, "update proposals set state = 'settled' where kind = 'purchase' and circle_id = $1", [circle.circleId]);
    await serviceRows(db, circle.circleId, "update purchase_rules set monthly_budget_cents = 150000 where circle_id = $1", [circle.circleId]);
    const second = await runRefill({ db: db.app, userId: circle.userId, circle: await snapshot(circle, circle.userId) }, { ruleId });
    expect(second).toMatchObject({ ok: true, mandate: { outcome: "ask_parent", reason: "already_used_this_period" } });
  });
});

describe("the Rose circle holds one, from the template", () => {
  it("has Rose's spoken permission, in force, sealed and labelled simulated", async () => {
    const circle = await visitorWithCircle(db);
    const [mandate] = (await snapshot(circle, circle.userId)).mandates;
    expect(mandate).toMatchObject({ grantedBy: circle.members.rose, status: "active", perPurchaseCents: 7000, cadence: "monthly", simulated: true });
    expect(mandate?.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
