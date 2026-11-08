import { SHIFT_CREDIT_TOPIC, asService, readLedger } from "@kin/db";
import { agreeWithoutCare, confirmedVisit, serviceRows, testDatabases, visitorWithCircle } from "@kin/db/testing";
import { accountBalance, careCreditAccount } from "@kin/domain";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { runCreditBatch } from "./run-credits.ts";

const db = testDatabases();
const deps = { db: db.service };
const lines: Record<string, unknown>[] = [];
const log: InboxLog = (line) => lines.push(line);

/** The batch leases whatever any circle has waiting, so it is drained until it finds nothing. */
async function drain(): Promise<void> {
  while ((await runCreditBatch(deps, log)) > 0);
}

const careBalance = (circleId: string, memberId: string) =>
  asService(db.service, circleId, async (tx) => accountBalance(await readLedger(tx, { id: circleId, currency: "USD" }), careCreditAccount(memberId)));
const message = (circleId: string) => serviceRows(db, circleId, "select sent_at is not null as sent, attempts, available_at > now() as later from outbox where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circleId]);

describe("the visit credit loop", () => {
  it("credits a confirmed visit from the outbox once, finishes the message, and credits nothing when handed it again", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle);
    const before = await careBalance(circle.circleId, circle.members.ana);
    await drain();
    // 45 minutes at 20.00 an hour.
    expect(await careBalance(circle.circleId, circle.members.ana)).toBe(before + 1_500);
    expect(await serviceRows(db, circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "credited" }]);
    expect(await message(circle.circleId)).toEqual([expect.objectContaining({ sent: true })]);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_credit.credited", shiftId: visit.shiftId }));

    // A crash after the work and before the message was marked: the message comes back, and nothing is credited twice.
    await serviceRows(db, circle.circleId, "update outbox set sent_at = null, available_at = now() where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circle.circleId]);
    await drain();
    expect(await careBalance(circle.circleId, circle.members.ana)).toBe(before + 1_500);
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_credit.already_credited", shiftId: visit.shiftId }));
    expect(await message(circle.circleId)).toEqual([expect.objectContaining({ sent: true })]);
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from care_entries where shift_id = $1", [visit.shiftId])).toEqual([{ n: 1 }]);
  });

  it("backs a failing message off, credits nothing while it fails, and credits it once the fault is gone", async () => {
    const circle = await visitorWithCircle(db);
    const visit = await confirmedVisit(db, circle);
    // A fault in this one circle only, so no other test's work is touched.
    await db.admin.$client.query(`create or replace function public.test_fail_care() returns trigger language plpgsql as $$ begin raise exception 'injected fault'; end $$`);
    await db.admin.$client.query(`create trigger test_fail_care before insert on public.care_entries for each row when (new.circle_id = '${circle.circleId}') execute function public.test_fail_care()`);
    try {
      await drain();
      expect(lines).toContainEqual(expect.objectContaining({ message: "shift_credit.retry", shiftId: visit.shiftId, seconds: 60 }));
      expect(await message(circle.circleId)).toEqual([{ sent: false, attempts: 1, later: true }]);
      expect(await serviceRows(db, circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "confirmed" }]);
      expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from ledger_entries where source_id like 'shift-credit-%'")).toEqual([{ n: 0 }]);
    } finally {
      await db.admin.$client.query("drop trigger test_fail_care on public.care_entries");
      await db.admin.$client.query("drop function public.test_fail_care()");
    }
    await serviceRows(db, circle.circleId, "update outbox set available_at = now() where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circle.circleId]);
    await drain();
    expect(await serviceRows(db, circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "credited" }]);
  });

  it("leaves a visit confirmed when the agreement counts no care time, finishes the message, and says why once", async () => {
    const circle = await visitorWithCircle(db);
    await agreeWithoutCare(db, circle);
    const visit = await confirmedVisit(db, circle);
    await drain();
    await serviceRows(db, circle.circleId, "update outbox set sent_at = null, available_at = now() where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circle.circleId]);
    await drain();
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_credit.no_care_terms", shiftId: visit.shiftId }));
    expect(await serviceRows(db, circle.circleId, "select state from shifts where id = $1", [visit.shiftId])).toEqual([{ state: "confirmed" }]);
    expect(await serviceRows(db, circle.circleId, "select details from audit_log where action = 'shift.credit_skipped' and subject_id = $1", [visit.shiftId])).toEqual([{ details: { reason: "no_care_terms" } }]);
    expect(await message(circle.circleId)).toEqual([expect.objectContaining({ sent: true })]);
  });

  it("drops a message it cannot read instead of retrying it for ever", async () => {
    const circle = await visitorWithCircle(db);
    await confirmedVisit(db, circle);
    await serviceRows(db, circle.circleId, "update outbox set payload = '{\"shiftId\": \"not-an-id\"}'::jsonb where topic = $1 and circle_id = $2", [SHIFT_CREDIT_TOPIC, circle.circleId]);
    await drain();
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_credit.unreadable_message" }));
    expect(await message(circle.circleId)).toEqual([expect.objectContaining({ sent: true })]);
  });
});
