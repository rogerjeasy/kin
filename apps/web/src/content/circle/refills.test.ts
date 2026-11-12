import { purchaseCaptured, type LedgerEntry } from "@kin/domain";
import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot, PurchaseRecord } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { anyPaidInSandbox, proposalsPaidInSandbox, refillViews } from "./refills";

const db = testDatabases();
let circle: CircleSnapshot;

beforeAll(async () => {
  const visitor = await visitorWithCircle(db);
  circle = await snapshotFor(db, visitor.userId, visitor.circleId);
});

const CAPTURE = "3E895632V1318045E";

function bought(id: string, simulated: boolean): LedgerEntry {
  return purchaseCaptured(
    { id: `entry-${id}`, circleId: circle.circle.id, occurredOn: "2026-11-11", period: "2026-11", description: "Refill bought", source: { type: "paypal_event", id }, currency: "USD", simulated },
    { category: "medication", cents: 6400 },
  );
}

function withOrder(paidItemId: string | null, entries: readonly LedgerEntry[]): CircleSnapshot {
  const [rule] = circle.purchaseRules;
  if (!rule) throw new Error("The demo circle has a refill rule");
  const purchase: PurchaseRecord = { id: "purchase-new", ruleId: rule.id, proposalId: "proposal-new", item: rule.item, cents: 6400, state: "ordered", merchantOrder: "order-1", orderedAt: null, deliveredAt: null, paidItemId };
  return { ...circle, purchases: [...circle.purchases, purchase], ledger: { ...circle.ledger, entries: [...circle.ledger.entries, ...entries] } };
}

const newest = (snapshot: CircleSnapshot) => refillViews(snapshot).orders.find((order) => order.purchase.id === "purchase-new");

describe("how a bought refill was paid", () => {
  it("is PayPal's sandbox, with PayPal's capture ID, when its ledger entry is not simulated", () => {
    const snapshot = withOrder(CAPTURE, [bought(CAPTURE, false)]);
    expect(newest(snapshot)?.payment).toEqual({ kind: "sandbox", captureId: CAPTURE });
    expect(anyPaidInSandbox(refillViews(snapshot).orders)).toBe(true);
    // Its answered proposal must not call the payment simulated (seen live on 12 November 2026).
    expect(proposalsPaidInSandbox(refillViews(snapshot).orders).has("proposal-new")).toBe(true);
  });

  it("is simulated when its ledger entry says so, whatever its ID looks like", () => {
    const snapshot = withOrder(CAPTURE, [bought(CAPTURE, true)]);
    expect(newest(snapshot)?.payment).toEqual({ kind: "simulated" });
    expect(anyPaidInSandbox(refillViews(snapshot).orders)).toBe(false);
    expect(proposalsPaidInSandbox(refillViews(snapshot).orders).has("proposal-new")).toBe(false);
  });

  it("is not claimed before the purchase is recorded in the ledger", () => {
    expect(newest(withOrder(null, []))?.payment).toBeNull();
    expect(newest(withOrder(CAPTURE, []))?.payment).toBeNull();
  });

  it("leaves the seeded demo's own orders simulated, so the screen still says no real money moves", () => {
    expect(anyPaidInSandbox(refillViews(circle).orders)).toBe(false);
  });
});
