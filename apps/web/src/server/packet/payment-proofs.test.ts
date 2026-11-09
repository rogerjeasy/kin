import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { fakePool } from "@kin/paypal/testing";
import { describe, expect, it } from "vitest";

import { lookbackView } from "@/content/circle/lookback";
import { circleToday } from "@/content/circle/today";

import { paymentProofs } from "./payment-proofs";

const db = testDatabases();

describe("what PayPal's own record says about each payment in the packet", () => {
  it("calls a payment PayPal's search does not list yet 'not yet listed' when it is from today or yesterday, and 'not found' when older", async () => {
    const visitor = await visitorWithCircle(db);
    const seen = await snapshotFor(db, visitor.userId, visitor.circleId);
    const today = circleToday(seen);
    const dayBefore = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    // Three payments out of the pool, made real: today, yesterday and a week ago. The fake PayPal lists none of them.
    const paid = seen.ledger.entries.filter((entry) => entry.kind === "payout_confirmed").slice(0, 3);
    expect(paid).toHaveLength(3);
    const days = [today, dayBefore(1), dayBefore(7)];
    const circle: CircleSnapshot = {
      ...seen,
      ledger: { ...seen.ledger, entries: seen.ledger.entries.map((entry) => { const at = paid.indexOf(entry); return at < 0 ? entry : { ...entry, simulated: false, occurredOn: days[at] ?? entry.occurredOn }; }) },
    };
    const view = lookbackView(circle, []);
    const withItems = { ...view, itemOf: new Map(paid.map((entry, at) => [entry.id, `ITEM${at}`])) };

    const proofs = await paymentProofs(circle, withItems, fakePool());
    const sourceOf = (id: string | undefined) => proofs.find((proof) => proof.entryId === id)?.source;
    expect(paid.map((entry) => sourceOf(entry.id))).toEqual(["not_yet_listed", "not_yet_listed", "not_found"]);
    // Simulated money is never looked up.
    expect(proofs.filter((proof) => !paid.some((entry) => entry.id === proof.entryId)).every((proof) => proof.source === "simulated")).toBe(true);
  });
});
