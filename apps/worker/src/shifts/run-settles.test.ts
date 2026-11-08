import { randomUUID } from "node:crypto";

import { SHIFT_SETTLE_TOPIC } from "@kin/db";
import { confirmedVisit, serviceRows, testDatabases, visitorWithCircle, waitingForWord } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

import { runSettleBatch } from "./run-settles.ts";
import { adminQuery, parentSaysYes } from "./shift-test-support.ts";

const db = testDatabases();
const deps = { db: db.service };
const lines: Record<string, unknown>[] = [];
const log: InboxLog = (line) => lines.push(line);
const admin = (text: string, params: readonly unknown[] = []) => adminQuery(db, text, params);

/** The batch leases whatever any circle has waiting, so it is drained until it finds nothing. */
async function drain(): Promise<void> {
  while ((await runSettleBatch(deps, log)) > 0);
}

/** An aide's shift whose caregiver has left and whose parent said yes on the phone: the database itself queues its settling. */
async function confirmedAideShift() {
  const circle = await waitingForWord(db);
  await parentSaysYes(db, circle, circle.shiftId);
  return circle;
}

const queueSettle = (circleId: string, shiftId: string) =>
  admin("insert into outbox (id, circle_id, topic, payload) values ($1, $2, $3, $4::jsonb)", [randomUUID(), circleId, SHIFT_SETTLE_TOPIC, JSON.stringify({ shiftId })]);
const messages = (circleId: string) =>
  serviceRows(db, circleId, "select sent_at is not null as sent, attempts, available_at > now() as later from outbox where topic = $1 and circle_id = $2 order by created_at, id", [SHIFT_SETTLE_TOPIC, circleId]);
const proposalsFor = (circleId: string, shiftId: string) =>
  serviceRows(db, circleId, "select p.state::text as state from proposals p join shifts s on s.circle_id = p.circle_id and s.proposal_id = p.id where s.id = $1", [shiftId]);
const shiftProposals = async (circleId: string) => Number((await serviceRows(db, circleId, "select count(*)::int as n from proposals where purpose = 'shift'"))[0]?.["n"]);
const executionCount = async (circleId: string) => Number((await serviceRows(db, circleId, "select count(*)::int as n from executions"))[0]?.["n"]);
const release = (circleId: string) => admin("update outbox set sent_at = null, available_at = now() where topic = $1 and circle_id = $2", [SHIFT_SETTLE_TOPIC, circleId]);
const pause = (circleId: string, memberId: string) => admin("update circles set paused_until = now() + interval '1 hour', paused_by = $1 where id = $2", [memberId, circleId]);

describe("the shift settling loop", () => {
  it("settles a shift the parent confirmed by phone, as the service, finishes the message, and raises no second proposal when handed it again", async () => {
    const circle = await confirmedAideShift();
    const { circleId, shiftId } = circle;
    // Rose's circle already holds shift proposals of its own: what must change is counted from here.
    const [proposals, executions] = [await shiftProposals(circleId), await executionCount(circleId)];
    expect(await messages(circleId)).toEqual([expect.objectContaining({ sent: false })]);
    await drain();
    expect(await proposalsFor(circleId, shiftId)).toHaveLength(1);
    expect(await messages(circleId)).toEqual([expect.objectContaining({ sent: true })]);
    expect(lines).toContainEqual(expect.objectContaining({ level: "info", message: "shift_settle.settled", shiftId }));
    expect(await serviceRows(db, circleId, "select actor::text as actor, origin from audit_log where action = 'shift.priced' and subject_id = $1", [shiftId])).toEqual([{ actor: "service", origin: "worker" }]);

    // A crash after the work and before the message was marked: it comes back, and nothing is settled twice.
    await release(circleId);
    await drain();
    expect(await shiftProposals(circleId)).toBe(proposals + 1);
    expect(await executionCount(circleId)).toBe(executions + 1);
    expect(await messages(circleId)).toEqual([expect.objectContaining({ sent: true })]);
  });

  it("settles a shift once even when two messages for it arrive", async () => {
    const { circleId, shiftId } = await confirmedAideShift();
    const proposals = await shiftProposals(circleId);
    await queueSettle(circleId, shiftId);
    await drain();
    expect(await shiftProposals(circleId)).toBe(proposals + 1);
    expect(await messages(circleId)).toEqual([expect.objectContaining({ sent: true }), expect.objectContaining({ sent: true })]);
  });

  it("holds a shift while the circle is paused, undoes no key, and settles it once the pause lifts", async () => {
    const circle = await confirmedAideShift();
    const { circleId, shiftId } = circle;
    await pause(circleId, circle.members.elena);
    await drain();
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_settle.held", shiftId, reason: "paused", seconds: 60 }));
    expect(await messages(circleId)).toEqual([{ sent: false, attempts: 1, later: true }]);
    expect(await serviceRows(db, circleId, "select state::text as state, proposal_id is null as open, family_confirmed_at is not null as word from shifts where id = $1", [shiftId])).toEqual([
      { state: "confirmed", open: true, word: true },
    ]);

    await admin("update circles set paused_until = null, paused_by = null where id = $1", [circleId]);
    await release(circleId);
    await drain();
    expect(await proposalsFor(circleId, shiftId)).toHaveLength(1);
    expect(await messages(circleId)).toEqual([expect.objectContaining({ sent: true })]);
  });

  it("doubles the delay each time a held shift comes back, and never drops its message", async () => {
    const circle = await confirmedAideShift();
    const { circleId, shiftId } = circle;
    await pause(circleId, circle.members.elena);
    await drain();
    await release(circleId);
    await drain();
    const delays = lines.filter((line) => line["message"] === "shift_settle.held" && line["shiftId"] === shiftId).map((line) => line["seconds"]);
    expect(delays).toEqual([60, 120]);
    expect(await messages(circleId)).toEqual([expect.objectContaining({ sent: false, attempts: 2 })]);
  });

  it("finishes the message of a shift no waiting can help, and says why", async () => {
    const circle = await visitorWithCircle(db);
    // A family visit is not paid care: nothing will ever be settled for it.
    const visit = await confirmedVisit(db, circle);
    await queueSettle(circle.circleId, visit.shiftId);
    await drain();
    expect(lines).toContainEqual(expect.objectContaining({ level: "error", message: "shift_settle.refused", shiftId: visit.shiftId, reason: "not_paid_kind" }));
    expect(await messages(circle.circleId)).toEqual([expect.objectContaining({ sent: true })]);
    expect(await proposalsFor(circle.circleId, visit.shiftId)).toEqual([]);
  });

  it("drops a message it cannot read instead of retrying it for ever", async () => {
    const circle = await visitorWithCircle(db);
    await admin(`insert into outbox (id, circle_id, topic, payload) values ($1, $2, $3, '{"shiftId": "not-an-id"}'::jsonb)`, [randomUUID(), circle.circleId, SHIFT_SETTLE_TOPIC]);
    await drain();
    expect(lines).toContainEqual(expect.objectContaining({ message: "shift_settle.unreadable_message" }));
    expect(await messages(circle.circleId)).toEqual([expect.objectContaining({ sent: true })]);
  });

  it("backs an unexpected failure off, settles nothing while it fails, and settles once the fault is gone", async () => {
    const { circleId, shiftId } = await confirmedAideShift();
    // A fault in this one circle only, so no other test's work is touched.
    await admin(`create or replace function public.test_fail_proposal() returns trigger language plpgsql as $$ begin raise exception 'injected fault'; end $$`);
    await admin(`create trigger test_fail_proposal before insert on public.proposals for each row when (new.circle_id = '${circleId}') execute function public.test_fail_proposal()`);
    try {
      await drain();
      expect(lines).toContainEqual(expect.objectContaining({ level: "error", message: "shift_settle.retry", shiftId, seconds: 60 }));
      expect(JSON.stringify(lines)).not.toContain("injected fault");
      expect(await messages(circleId)).toEqual([{ sent: false, attempts: 1, later: true }]);
      expect(await proposalsFor(circleId, shiftId)).toEqual([]);
    } finally {
      await admin("drop trigger test_fail_proposal on public.proposals");
      await admin("drop function public.test_fail_proposal()");
    }
    await release(circleId);
    await drain();
    expect(await proposalsFor(circleId, shiftId)).toHaveLength(1);
  });
});
