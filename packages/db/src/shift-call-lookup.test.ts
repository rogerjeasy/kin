import { randomUUID } from "node:crypto";

import { dayPart } from "@kin/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { findStaleShiftCall, openShiftCallForWebhook } from "./shift-call-lookup.ts";
import { asService } from "./scope.ts";
import { startedCall, waitingForWord, type RealCircle } from "./testing/real-shifts.ts";
import { testDatabases } from "./testing/databases.ts";

const db = testDatabases();
const service = <T>(circleId: string, work: Parameters<typeof asService<T>>[2]) => asService(db.service, circleId, work);
const sid = () => `CA${randomUUID().replaceAll("-", "")}`;
const open = (circle: RealCircle, shiftId: string, attempt: number, callSid: string) =>
  service(circle.circleId, (tx) => openShiftCallForWebhook(tx, { circleId: circle.circleId, shiftId, attempt, callSid }));

describe("tying a webhook to Kin's call", () => {
  it("loads the first names and the part of the day from the record, and the family contact who set the shift up", async () => {
    const circle = await waitingForWord(db);
    const { callSid, call } = await startedCall(db, circle, circle.shiftId);
    const record = await open(circle, circle.shiftId, call.attempt, callSid ?? "");
    const started = (await db.admin.execute<{ at: string }>(sql`select checked_in_at as at from shifts where id = ${circle.shiftId}`)).rows[0]?.at ?? "";
    expect(record).toEqual({ state: "calling", caregiverName: "Amara", dayPart: dayPart(new Date(started), "UTC"), contactName: "Elena" });
  });

  it("gives no contact when whoever set the shift up is not a family member who sees the result", async () => {
    const circle = await waitingForWord(db);
    const { callSid, call } = await startedCall(db, circle, circle.shiftId);
    await db.admin.execute(sql`update members set role = 'observer' where id = ${circle.members.elena}`);
    expect(await open(circle, circle.shiftId, call.attempt, callSid ?? "")).toMatchObject({ contactName: null });
  });

  it("takes the first webhook for an attempt still waiting for its ID, and refuses any other ID after", async () => {
    const circle = await waitingForWord(db);
    const { call } = await startedCall(db, circle, circle.shiftId, { place: false });
    const first = sid();
    expect(await open(circle, circle.shiftId, call.attempt, first)).toMatchObject({ state: "calling" });
    expect(await open(circle, circle.shiftId, call.attempt, first)).toMatchObject({ state: "calling" });
    expect(await open(circle, circle.shiftId, call.attempt, sid())).toBeNull();
    expect((await db.admin.execute<{ call_sid: string }>(sql`select call_sid from shift_calls where id = ${call.callId}`)).rows).toEqual([{ call_sid: first }]);
  });

  it("refuses an ID of another shift's call, in this circle or another, another attempt, another shift, and a call that was never placed", async () => {
    const [mine, theirs] = [await waitingForWord(db), await waitingForWord(db)];
    const [placed, other] = [await startedCall(db, mine, mine.shiftId), await startedCall(db, theirs, theirs.shiftId)];
    const attempt = placed.call.attempt;
    expect(await open(mine, mine.shiftId, attempt, placed.callSid ?? "")).toMatchObject({ state: "calling" });
    expect(await open(mine, mine.shiftId, attempt, other.callSid ?? "")).toBeNull();
    expect(await open(mine, mine.shiftId, attempt, sid())).toBeNull();
    expect(await open(mine, mine.shiftId, attempt + 1, placed.callSid ?? "")).toBeNull();
    expect(await open(mine, randomUUID(), attempt, placed.callSid ?? "")).toBeNull();
    // The other circle's own attempt is not reachable with my scope, whatever the request says.
    expect(await service(mine.circleId, (tx) => openShiftCallForWebhook(tx, { circleId: theirs.circleId, shiftId: theirs.shiftId, attempt: other.call.attempt, callSid: other.callSid ?? "" }))).toBeNull();

    const unplaced = await waitingForWord(db);
    const { call } = await startedCall(db, unplaced, unplaced.shiftId, { place: false });
    await db.admin.execute(sql`update shift_calls set state = 'failed', ended_at = now() where id = ${call.callId}`);
    expect(await open(unplaced, unplaced.shiftId, call.attempt, sid())).toBeNull();
  });
});

describe("finding an attempt whose report was lost", () => {
  it("finds an active attempt only once it is older than the limit", async () => {
    const circle = await waitingForWord(db);
    const { call } = await startedCall(db, circle, circle.shiftId);
    const find = (staleMinutes: number) => service(circle.circleId, (tx) => findStaleShiftCall(tx, { circleId: circle.circleId, shiftId: circle.shiftId, staleMinutes }));
    expect(await find(30)).toBeNull();
    expect(await find(0)).toMatchObject({ attempt: call.attempt, state: "calling" });
    await db.admin.execute(sql`update shift_calls set state = 'no_answer', ended_at = now() where id = ${call.callId}`);
    expect(await find(0)).toBeNull();
  });

  it("sees nothing of another circle's attempts", async () => {
    const [mine, theirs] = [await waitingForWord(db), await waitingForWord(db)];
    await startedCall(db, theirs, theirs.shiftId);
    expect(await service(mine.circleId, (tx) => findStaleShiftCall(tx, { circleId: theirs.circleId, shiftId: theirs.shiftId, staleMinutes: 0 }))).toBeNull();
  });
});
