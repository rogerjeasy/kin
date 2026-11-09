import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readLineRecord } from "./office-calls.ts";
import { readPresenceLine } from "./presence.ts";
import { asService } from "./scope.ts";
import { snapshotFor, testDatabases, visitorWithCircle } from "./testing/index.ts";

const db = testDatabases();

/**
 * A transaction is one connection: queries sent on it at once are queued by
 * pg 8 and refused by pg 9. Every read here runs its queries one at a time.
 * pg 8 warns when a query arrives while another already waits in its queue,
 * that is from the third at once, and only once per process; each test file
 * runs in a process of its own, so this file sees that first warning.
 */
const warnings: string[] = [];
const listen = (warning: Error) => {
  if (warning.message.includes("already executing a query")) warnings.push(warning.message);
};
beforeAll(() => {
  process.on("warning", listen);
});
afterAll(() => {
  process.off("warning", listen);
});

describe("reading a circle", () => {
  it("never sends a query on a transaction while another is running", async () => {
    const circle = await visitorWithCircle(db);
    // The whole snapshot: the ledger, the refill rules with their spend this month, the presence hold and the rest.
    await snapshotFor(db, circle.userId, circle.circleId);
    await asService(db.service, circle.circleId, (tx) => readLineRecord(tx, circle.circleId));
    await asService(db.service, circle.circleId, (tx) => readPresenceLine(tx, circle.circleId));
    // A warning is emitted on the next turn of the event loop.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnings).toEqual([]);
  });
});
