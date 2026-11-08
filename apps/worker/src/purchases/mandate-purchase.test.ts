import { asPerson, proposeRefill, type RefillProposed } from "@kin/db";
import { endMandates, pauseMandates, personQuery, serviceRows, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { afterEach, describe, expect, it } from "vitest";

import { executePurchase, type PurchaseDeps } from "./execute-purchase.ts";
import { MerchantError, simulatedMerchant } from "./merchant.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const REAL_START = new Date("2026-11-07T10:00:00Z");
const deps: PurchaseDeps = { db: db.service, merchant: simulatedMerchant, now: () => REAL_START };

// These purchases are carried out by hand below, so their queued messages are marked sent to
// leave the shared outbox to the runner tests that read it.
const made: string[] = [];
async function newCircle(): Promise<VisitorCircle> {
  const circle = await visitorWithCircle(db);
  made.push(circle.circleId);
  return circle;
}
afterEach(async () => {
  for (const circleId of made.splice(0)) await serviceRows(db, circleId, "update outbox set sent_at = now() where circle_id = $1", [circleId]);
});

const row = async (circleId: string, query: string, id: string) => (await serviceRows(db, circleId, query, [id]))[0];

async function ruleOf(circle: VisitorCircle): Promise<string> {
  const [rule] = (await snapshotFor(db, circle.userId, circle.circleId)).purchaseRules;
  if (!rule) throw new Error("The demo circle has no refill rule");
  return rule.id;
}

const raise = (circle: VisitorCircle, ruleId: string): Promise<RefillProposed> =>
  asPerson(db.app, circle.userId, (tx) => proposeRefill(tx, { circleId: circle.circleId, ruleId, now: CLOCK }));

describe("a refill inside Rose's spoken mandate", () => {
  it("is approved with the mandate as the approver, bought through the ordinary path, and traced back to the mandate", async () => {
    const circle = await newCircle();
    const ruleId = await ruleOf(circle);
    const raised = await raise(circle, ruleId);
    expect(raised.mandate).toMatchObject({ outcome: "covered" });

    expect(await row(circle.circleId, "select state, plan from proposals where id = $1", raised.id)).toMatchObject({ state: "approved", plan: { outcome: "mandate" } });
    const approval = await row(circle.circleId, "select member_id, role, method, decision, evidence_ref from approvals where proposal_id = $1", raised.id);
    expect(approval).toMatchObject({ member_id: circle.members.rose, role: "parent", method: "mandate", decision: "approve" });
    expect(await row(circle.circleId, "select cents, period from mandate_uses where proposal_id = $1", raised.id)).toEqual({ cents: "6400", period: "2026-10" });

    const execution = await row(circle.circleId, "select id from executions where proposal_id = $1", raised.id);
    expect(await executePurchase(deps, circle.circleId, String(execution?.id))).toMatchObject({ next: "done", result: "confirmed" });
    expect(await row(circle.circleId, "select state from proposals where id = $1", raised.id)).toEqual({ state: "settled" });
    const confirmed = await serviceRows(db, circle.circleId, "select details from audit_log where circle_id = $1 and action = 'purchase.confirmed'", [circle.circleId]);
    expect(confirmed[0]?.details).toMatchObject({ simulated: true, mandateId: (approval?.evidence_ref as string).replace("mandate:", "") });
  });

  it("falls back to asking Rose, with the reason, when the price rises above what she allowed", async () => {
    const circle = await newCircle();
    const ruleId = await ruleOf(circle);
    await serviceRows(db, circle.circleId, "update purchase_rules set price_cents = 7200 where id = $1", [ruleId]);
    const raised = await raise(circle, ruleId);
    expect(raised.mandate).toEqual({ outcome: "ask_parent", reason: "above_per_purchase" });
    expect(await row(circle.circleId, "select state, plan from proposals where id = $1", raised.id)).toMatchObject({ state: "pending_approval", plan: { outcome: "needs_approval" } });
    expect(await row(circle.circleId, "select count(*)::int as n from mandate_uses where circle_id = $1", circle.circleId)).toEqual({ n: 0 });
  });

  it("covers one purchase a month: the next asks Rose, and a paused or ended mandate covers none", async () => {
    const circle = await newCircle();
    const ruleId = await ruleOf(circle);
    const first = await raise(circle, ruleId);
    await executePurchase(deps, circle.circleId, String((await row(circle.circleId, "select id from executions where proposal_id = $1", first.id))?.id));
    await serviceRows(db, circle.circleId, "update purchase_rules set monthly_budget_cents = 150000 where id = $1", [ruleId]);
    expect((await raise(circle, ruleId)).mandate).toEqual({ outcome: "ask_parent", reason: "already_used_this_period" });

    const paused = await newCircle();
    await pauseMandates(db, paused.circleId);
    expect((await raise(paused, await ruleOf(paused))).mandate).toEqual({ outcome: "ask_parent", reason: "paused" });

    const ended = await newCircle();
    await endMandates(db, ended.circleId);
    expect((await raise(ended, await ruleOf(ended))).mandate).toEqual({ outcome: "none" });
  });

  it("cannot be forged: a plan that names a mandate the refill does not fit is refused by the database", async () => {
    const circle = await newCircle();
    const ruleId = await ruleOf(circle);
    await serviceRows(db, circle.circleId, "update purchase_rules set price_cents = 7200 where id = $1", [ruleId]);
    const mandate = await row(circle.circleId, "select id from mandates where circle_id = $1", circle.circleId);
    const version = await row(circle.circleId, "select version from agreements where circle_id = $1 order by version desc limit 1", circle.circleId);
    const plan = JSON.stringify({ outcome: "mandate", mandateId: mandate?.id, agreementVersion: Number(version?.version) });
    await expect(
      personQuery(db, circle.userId, "select kin_private.propose_refill('" + circle.circleId + "'::uuid, '" + ruleId + "'::uuid, '" + plan + "'::jsonb)"),
    ).rejects.toMatchObject({ cause: { code: "KM010" } });
    expect(await row(circle.circleId, "select count(*)::int as n from proposals where circle_id = $1 and kind = 'purchase'", circle.circleId)).toEqual({ n: 0 });
  });

  it("has the seller refuse a charge beyond the allowance, a second check beside the first", async () => {
    await expect(simulatedMerchant.placeOrder({ key: "k", item: "x", cents: 5800, currency: "USD", mandate: { id: "m", allowanceCents: 5000 } })).rejects.toBeInstanceOf(MerchantError);
    await expect(simulatedMerchant.placeOrder({ key: "k", item: "x", cents: 5000, currency: "USD", mandate: { id: "m", allowanceCents: 5000 } })).resolves.toEqual({ ref: "simulated-order-k", charge: { kind: "simulated" } });
  });
});
