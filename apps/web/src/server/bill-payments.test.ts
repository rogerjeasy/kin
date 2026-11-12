import { addLetter, asPerson, readCircle, takeDemoSeat, type CircleSnapshot } from "@kin/db";
import { visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";

import { runBillPayment } from "./bill-payments";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle): Promise<CircleSnapshot> => asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
const run = async (circle: VisitorCircle, input: unknown) => runBillPayment({ db: db.app, userId: circle.userId, circle: await snapshot(circle) }, input);

async function letterBill(circle: VisitorCircle): Promise<string> {
  await as(circle, "rose");
  const recorded = await asPerson(db.app, circle.userId, (tx) => addLetter(tx, { circleId: circle.circleId, kind: "bill", payeeId: null, sender: "Greenway Power", amountCents: 8_640, dueOn: "2026-11-20", extraction: { kind: "bill" }, confidence: 0.9 }));
  if (!recorded.billId) throw new Error("No bill");
  await as(circle, "elena");
  return recorded.billId;
}
const review = (billId: string, change: Record<string, unknown> = {}) => ({ operation: "review", billId, name: "Greenway Power", amount: "61.00", dueOn: "2026-11-30", receiver: "billing@greenway.example", ...change });

describe("a bill read from a letter at the untrusted request boundary", () => {
  it("reads the amount digit by digit and raises a bill payment for a payee with a PayPal address", async () => {
    const circle = await visitorWithCircle(db);
    const billId = await letterBill(circle);
    const result = await run(circle, review(billId));
    expect(result).toMatchObject({ ok: true, route: "paypal", proposalId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const after = await snapshot(circle);
    expect(after.proposals.find((each) => "proposalId" in result && each.id === result.proposalId)).toMatchObject({ kind: "bill_payment", cents: 6_100 });
  });

  it("keeps a bill without a PayPal address to be paid outside Kin, and files the member's receipt for it", async () => {
    const circle = await visitorWithCircle(db);
    const billId = await letterBill(circle);
    expect(await run(circle, review(billId, { receiver: null }))).toEqual({ ok: true, route: "outside", proposalId: null });
    await as(circle, "marcus");
    const id = randomUUID();
    expect(await run(circle, { operation: "paid_outside", billId, id, spentOn: "2026-10-29" })).toEqual({ ok: true, id });
    expect((await snapshot(circle)).receipts.find((each) => each.id === id)).toMatchObject({ billId, cents: 6_100, state: "submitted", memberId: circle.members.marcus });
  });

  it("refuses what the money core refuses, forged fields and an unknown operation", async () => {
    const circle = await visitorWithCircle(db);
    const billId = await letterBill(circle);
    for (const [change, reason] of [
      [{ amount: "1e3" }, "amount"], [{ amount: "0.00" }, "amount"], [{ amount: 61 }, "invalid"],
      [{ name: " " }, "name"], [{ dueOn: "2026-02-30" }, "due"], [{ receiver: "nobody" }, "receiver"],
      [{ billId: "not-a-uuid" }, "invalid"], [{ planned: true }, "invalid"],
    ] as const) {
      expect(await run(circle, review(billId, change))).toEqual({ ok: false, reason });
    }
    for (const input of [{ operation: "pay_now", billId }, { operation: "paid_outside", billId, id: randomUUID(), spentOn: "yesterday" }, null, []]) {
      expect(await run(circle, input)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("is refused to the parent, the caregiver and the observer before anything is asked of the database", async () => {
    const circle = await visitorWithCircle(db);
    const billId = await letterBill(circle);
    for (const persona of ["rose", "amara", "daniel"] as const) {
      await as(circle, persona);
      expect(await run(circle, review(billId))).toEqual({ ok: false, reason: "refused" });
      expect(await run(circle, { operation: "paid_outside", billId, id: randomUUID(), spentOn: "2026-10-29" })).toEqual({ ok: false, reason: "refused" });
    }
  });
});
