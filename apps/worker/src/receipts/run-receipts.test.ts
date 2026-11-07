import { RECEIPT_TOPIC, asPerson, asService, decideReceipt, readLedger, submitReceipt } from "@kin/db";
import { seatPerson, serviceRows, testDatabases, visitorWithCircle } from "@kin/db/testing";
import { accountBalance, memberAccount } from "@kin/domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { runReceiptBatch } from "./run-receipts.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const deps = { db: db.service, now: () => CLOCK };
const lines: Record<string, unknown>[] = [];
const log: InboxLog = (line) => lines.push(line);

/** The batch leases whatever any circle has waiting, so it is drained until it finds nothing. */
async function drain(): Promise<void> {
  while ((await runReceiptBatch(deps, log)) > 0);
}

async function approvedReceipt(cents = 4200) {
  const circle = await visitorWithCircle(db);
  const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
  const id = randomUUID();
  await asPerson(db.app, marcus, (tx) => submitReceipt(tx, { circleId: circle.circleId, id, receipt: { category: "pharmacy", cents, description: "Elm Street Pharmacy", spentOn: "2026-10-28" } }));
  await asPerson(db.app, circle.userId, (tx) => decideReceipt(tx, { circleId: circle.circleId, receiptId: id, approve: true }));
  return { circle, id };
}

const marcusBalance = (circleId: string, memberId: string) => asService(db.service, circleId, async (tx) => accountBalance(await readLedger(tx, { id: circleId, currency: "USD" }), memberAccount(memberId)));

describe("the receipt credit loop", () => {
  it("credits an approved receipt from the outbox, finishes the message, and does not credit it again", async () => {
    const { circle, id } = await approvedReceipt();
    const before = await marcusBalance(circle.circleId, circle.members.marcus);
    await drain();
    expect(await marcusBalance(circle.circleId, circle.members.marcus)).toBe(before + 4200);
    expect(await serviceRows(db, circle.circleId, "select state from receipts where id = $1", [id])).toEqual([{ state: "credited" }]);
    expect(await serviceRows(db, circle.circleId, "select sent_at is not null as sent from outbox where topic = $1", [RECEIPT_TOPIC])).toEqual([{ sent: true }]);
    await drain();
    expect(await marcusBalance(circle.circleId, circle.members.marcus)).toBe(before + 4200);
  });

  it("drops a message it cannot read instead of retrying it for ever", async () => {
    const { circle } = await approvedReceipt();
    await serviceRows(db, circle.circleId, "update outbox set payload = '{\"receiptId\": \"not-an-id\"}'::jsonb where topic = $1 and circle_id = $2", [RECEIPT_TOPIC, circle.circleId]);
    await drain();
    expect(lines).toContainEqual(expect.objectContaining({ message: "receipt.unreadable_message" }));
    expect(await serviceRows(db, circle.circleId, "select sent_at is not null as sent from outbox where topic = $1", [RECEIPT_TOPIC])).toEqual([{ sent: true }]);
  });
});
