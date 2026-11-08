import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { hashCheckToken, mintCheckLink, newCheckToken, useCheckLink } from "../check-links.ts";
import { recordCallPlaced, recordCallStatus, recordFamilyWordByCall, setParentCallSettings, startShiftCall, type ShiftCallToDial } from "../shift-calls.ts";
import { cancelShift, checkOutShift, confirmShift, settleShiftAsService } from "../shifts.ts";
import { asPerson, asService } from "../scope.ts";
import { snapshotFor } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { PARENT_PHONE, enableCalls, openAideShift, queued, realCircle, reasonOf, setQuietHours, withoutTriggers, type RealCircle } from "../testing/real-shifts.ts";
import { visitorWithCircle } from "../testing/circles.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const service = <T>(circleId: string, work: Parameters<typeof asService<T>>[2]) => asService(db.service, circleId, work);
const reason = reasonOf;
const sid = (): string => `CA${randomUUID().replaceAll("-", "")}`;

/** A real circle whose parent has switched the call on and whose aide has just left a visit that began two hours ago. */
async function waitingForWord(): Promise<RealCircle & { shiftId: string }> {
  const circle = await realCircle(db);
  await enableCalls(db, circle);
  await setQuietHours(db, circle.circleId, "outside");
  const shiftId = await openAideShift(db, circle);
  await person(circle.amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId, now: new Date() }));
  return { ...circle, shiftId };
}
const start = (circle: RealCircle, shiftId: string) => service(circle.circleId, (tx) => startShiftCall(tx, { circleId: circle.circleId, shiftId }));
async function dial(circle: RealCircle, shiftId: string): Promise<ShiftCallToDial> {
  const started = await start(circle, shiftId);
  if (started.kind !== "dial") throw new Error(`The call was refused: ${started.reason}`);
  return started;
}
/** A started call whose provider has taken it, and the ID it was given. */
async function placed(circle: RealCircle, shiftId: string): Promise<{ call: ShiftCallToDial; callSid: string }> {
  const call = await dial(circle, shiftId);
  const callSid = sid();
  await service(circle.circleId, (tx) => recordCallPlaced(tx, { circleId: circle.circleId, shiftId, callId: call.callId, callSid }));
  return { call, callSid };
}
const word = (circle: RealCircle, shiftId: string, callSid: string, answer: "yes" | "no" | "unclear") =>
  service(circle.circleId, (tx) => recordFamilyWordByCall(tx, { circleId: circle.circleId, shiftId, callSid, answer }));
const shiftRow = async (shiftId: string) =>
  (await db.admin.execute<{ state: string; by: string | null; kind: string | null; evidence: string | null }>(
    sql`select state::text, family_confirmed_by as by, family_confirmation as kind, family_evidence_ref as evidence from shifts where id = ${shiftId}`,
  )).rows[0];
const pastTheWait = (): Promise<unknown> => withoutTriggers(db, (run) => run(sql`update shift_calls set ended_at = ended_at - interval '1 hour', created_at = created_at - interval '1 hour'`));

describe("switching the call on", () => {
  it("is the parent's to do in a real circle, with her consent on record and her number nowhere in the audit", async () => {
    const circle = await realCircle(db);
    const set = (userId: string, patch: Partial<Parameters<typeof setParentCallSettings>[1]> = {}) =>
      reason(person(userId, (tx) => setParentCallSettings(tx, { circleId: circle.circleId, phone: PARENT_PHONE, enabled: true, consent: true, ...patch })));
    expect(await set(circle.rose, { consent: false })).toBe("consent_needed");
    expect(await set(circle.rose, { phone: "555-0142" })).toBe("invalid");
    expect(await set(circle.rose, { phone: "+0155555" })).toBe("invalid");
    // The organizer cannot stand in for her, in a real circle.
    expect(await set(circle.userId)).toBe("refused");
    expect((await db.admin.execute(sql`select 1 from parent_call_settings where circle_id = ${circle.circleId}`)).rows).toHaveLength(0);
    expect(await set(circle.rose)).toBe("no error");
    const row = (await db.admin.execute<{ enabled: boolean; member_id: string; consented_by: string; consented_at: Date; locale: string; quiet_start: string; quiet_end: string }>(
      sql`select enabled, member_id, consented_by, consented_at, locale, quiet_start::text, quiet_end::text from parent_call_settings where circle_id = ${circle.circleId}`,
    )).rows[0];
    expect(row).toMatchObject({ enabled: true, member_id: circle.members.rose, consented_by: circle.members.rose, locale: "en", quiet_start: "21:00:00", quiet_end: "08:00:00" });
    expect(Math.abs(new Date(row?.consented_at ?? 0).getTime() - Date.now())).toBeLessThan(60_000);
    const audit = await db.admin.execute<{ details: unknown }>(sql`select details from audit_log where circle_id = ${circle.circleId} and action like 'parent_call.%'`);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain("5555550142");
  });

  it("is switched off by the family at any time, and switched on again only with consent given again", async () => {
    const circle = await realCircle(db);
    await enableCalls(db, circle);
    const set = (userId: string, enabled: boolean, consent = false) => reason(person(userId, (tx) => setParentCallSettings(tx, { circleId: circle.circleId, phone: PARENT_PHONE, enabled, consent })));
    expect(await set(circle.amara, false)).toBe("refused");
    expect(await set(circle.userId, false)).toBe("no error");
    const enabled = async () => (await db.admin.execute<{ enabled: boolean }>(sql`select enabled from parent_call_settings where circle_id = ${circle.circleId}`)).rows[0]?.enabled;
    expect(await enabled()).toBe(false);
    expect(await set(circle.userId, false)).toBe("no error");
    expect(await set(circle.rose, true)).toBe("consent_needed");
    expect(await enabled()).toBe(false);
    expect(await set(circle.rose, true, true)).toBe("no error");
    expect(await enabled()).toBe(true);
  });

  it("shows the parent and the organizer whether it is on, never the number, and nobody else anything", async () => {
    const circle = await realCircle(db);
    await enableCalls(db, circle);
    const read = (userId: string) => person(userId, (tx) => tx.execute(sql`select member_id, enabled, quiet_start from parent_call_settings`));
    expect((await read(circle.rose)).rows).toHaveLength(1);
    expect((await read(circle.userId)).rows).toHaveLength(1);
    expect((await read(circle.amara)).rows).toHaveLength(0);
    for (const userId of [circle.rose, circle.userId, circle.amara]) expect(await errorCode(person(userId, (tx) => tx.execute(sql`select phone from parent_call_settings`)))).toBe(REFUSED.permission);
    expect(await errorCode(person(circle.rose, (tx) => tx.execute(sql`select * from parent_call_settings`)))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`select phone from parent_call_settings`)))).toBe(REFUSED.permission);
    const organizer = await snapshotFor(db, circle.userId, circle.circleId);
    expect(organizer.parentCallSettings).toMatchObject({ memberId: circle.members.rose, enabled: true, consentedBy: circle.members.rose });
    expect(JSON.stringify(organizer)).not.toContain("5555550142");
    expect((await snapshotFor(db, circle.rose, circle.circleId)).parentCallSettings?.enabled).toBe(true);
    expect((await snapshotFor(db, circle.amara, circle.circleId)).parentCallSettings).toBeNull();
  });

  it("lets a demo circle's organizer play the parent, and never places a call for it", async () => {
    const circle = await visitorWithCircle(db);
    await person(circle.userId, (tx) => setParentCallSettings(tx, { circleId: circle.circleId, phone: PARENT_PHONE, enabled: true, consent: true }));
    const row = (await db.admin.execute<{ member_id: string; consented_by: string }>(sql`select member_id, consented_by from parent_call_settings where circle_id = ${circle.circleId}`)).rows[0];
    expect(row).toEqual({ member_id: circle.members.rose, consented_by: circle.members.elena });
    const shiftId = randomUUID();
    await db.admin.execute(sql`insert into shifts (id, circle_id, kind, member_id, payee_id, starts_at, ends_at, state, checked_in_at, checked_out_at, created_by)
      values (${shiftId}, ${circle.circleId}, 'aide', ${circle.members.amara}, ${circle.payees.amara}, now() - interval '3 hours', now() - interval '1 hour', 'checked_out', now() - interval '3 hours', now() - interval '1 hour', ${circle.members.elena})`);
    expect(await service(circle.circleId, (tx) => startShiftCall(tx, { circleId: circle.circleId, shiftId }))).toEqual({ kind: "refused", reason: "demo_circle", retryAt: null });
    expect(await queued(db, circle.circleId, "shift.call")).toEqual([]);
  });

  it("is refused to a person of another circle, who also reads none of it", async () => {
    const [mine, theirs] = [await realCircle(db), await realCircle(db)];
    await enableCalls(db, theirs);
    expect(await reason(person(mine.rose, (tx) => setParentCallSettings(tx, { circleId: theirs.circleId, phone: PARENT_PHONE, enabled: true, consent: true })))).toBe("refused");
    expect((await person(mine.userId, (tx) => tx.execute(sql`select id from parent_call_settings where circle_id = ${theirs.circleId}`))).rows).toEqual([]);
    expect((await asService(db.service, mine.circleId, (tx) => tx.execute(sql`select id from parent_call_settings where circle_id = ${theirs.circleId}`))).rows).toEqual([]);
    expect((await asService(db.service, mine.circleId, (tx) => tx.execute(sql`select id from shift_calls where circle_id = ${theirs.circleId}`))).rows).toEqual([]);
    expect(await errorCode(asService(db.service, mine.circleId, (tx) => tx.execute(sql`update parent_call_settings set enabled = false`)))).toBe(REFUSED.permission);
  });
});

describe("when a visit queues a call", () => {
  it("queues one for an aide's shift in a real circle that waits for the family's word, and only the turn that closes the visit", async () => {
    const circle = await waitingForWord();
    expect(await queued(db, circle.circleId, "shift.call")).toMatchObject([{ payload: { shiftId: circle.shiftId } }]);
    await person(circle.amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId: circle.shiftId, now: new Date() }));
    expect(await queued(db, circle.circleId, "shift.call")).toHaveLength(1);
  });

  it("queues the call just the same when the caregiver closes the visit from a check-in link", async () => {
    const circle = await realCircle(db);
    await enableCalls(db, circle);
    const shiftId = await openAideShift(db, circle);
    const token = newCheckToken();
    await person(circle.amara, (tx) => mintCheckLink(tx, { circleId: circle.circleId, shiftId, tokenHash: hashCheckToken(token), expiresAt: new Date(Date.now() + 3_600_000) }));
    expect(await useCheckLink(db.app, { token, action: "out" })).toMatchObject({ state: "checked_out", familyWordIn: false });
    expect(await queued(db, circle.circleId, "shift.call")).toMatchObject([{ payload: { shiftId } }]);
    await useCheckLink(db.app, { token, action: "out" });
    expect(await queued(db, circle.circleId, "shift.call")).toHaveLength(1);
    expect(await queued(db, circle.circleId, "shift.settle")).toEqual([]);
  });

  it("queues none when the word is already in, the call is off or was never set up, the shift is a sibling's, or the circle is a demo", async () => {
    const circle = await realCircle(db);
    const leave = async () => {
      const shiftId = await openAideShift(db, circle);
      return { shiftId, turn: () => person(circle.amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId, now: new Date() })) };
    };
    // Never set up.
    await (await leave()).turn();
    await enableCalls(db, circle);
    // Her word already in.
    const confirmed = await leave();
    await person(circle.rose, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId: confirmed.shiftId, now: new Date() }));
    await confirmed.turn();
    // A sibling's visit is not paid, so there is nothing to ask her.
    const visitId = randomUUID();
    await db.admin.execute(sql`insert into shifts (id, circle_id, kind, member_id, starts_at, ends_at, state, checked_in_at, created_by)
      values (${visitId}, ${circle.circleId}, 'visit', ${circle.members.ana}, now() - interval '3 hours', now() + interval '1 hour', 'checked_in', now() - interval '2 hours', ${circle.members.elena})`);
    expect(await queued(db, circle.circleId, "shift.call")).toEqual([]);
    // Switched off.
    await person(circle.userId, (tx) => setParentCallSettings(tx, { circleId: circle.circleId, phone: null, enabled: false, consent: false }));
    await (await leave()).turn();
    expect(await queued(db, circle.circleId, "shift.call")).toEqual([]);
  });
});

describe("starting Kin's call", () => {
  it("gives the worker what it needs to dial, once, and says why when it must not", async () => {
    const circle = await waitingForWord();
    const call = await dial(circle, circle.shiftId);
    expect(call).toMatchObject({ kind: "dial", attempt: 1, shiftId: circle.shiftId, phone: PARENT_PHONE, locale: "en", parentMemberId: circle.members.rose, timezone: "UTC" });
    expect(call.caregiverFirstName).toBe("Amara");
    expect(call.checkedOutAt.getTime()).toBeGreaterThan(call.checkedInAt.getTime());
    expect(await start(circle, circle.shiftId)).toEqual({ kind: "refused", reason: "in_progress", retryAt: null });
    const states = await db.admin.execute<{ state: string; attempt: number; call_sid: string | null }>(sql`select state, attempt, call_sid from shift_calls where shift_id = ${circle.shiftId}`);
    expect(states.rows).toEqual([{ state: "queued", attempt: 1, call_sid: null }]);
    const audit = await db.admin.execute<{ details: unknown; actor: string }>(sql`select details, actor::text from audit_log where action = 'shift.call_started' and circle_id = ${circle.circleId}`);
    expect(audit.rows).toMatchObject([{ actor: "service" }]);
    expect(JSON.stringify(audit.rows)).not.toContain("5555550142");
  });

  it("holds the call back inside the quiet hours of the circle's clock, and says when they end", async () => {
    const circle = await waitingForWord();
    await setQuietHours(db, circle.circleId, "inside");
    const refused = await start(circle, circle.shiftId);
    expect(refused).toMatchObject({ kind: "refused", reason: "quiet_hours" });
    const retryAt = refused.kind === "refused" ? refused.retryAt : null;
    expect(retryAt && retryAt.getTime() > Date.now() && retryAt.getTime() <= Date.now() + 3 * 3_600_000).toBe(true);
    await setQuietHours(db, circle.circleId, "outside");
    expect((await start(circle, circle.shiftId)).kind).toBe("dial");
  });

  it("is refused for a shift that is not waiting, a call that is off, a parent who has left, and a visit too long ago", async () => {
    const circle = await waitingForWord();
    const refusal = async (shiftId = circle.shiftId) => {
      const result = await start(circle, shiftId);
      return result.kind === "refused" ? result.reason : "dial";
    };
    expect(await refusal(await openAideShift(db, circle))).toBe("not_waiting");
    await person(circle.userId, (tx) => setParentCallSettings(tx, { circleId: circle.circleId, phone: null, enabled: false, consent: false }));
    expect(await refusal()).toBe("not_enabled");
    await enableCalls(db, circle);
    await db.admin.execute(sql`update members set status = 'left' where id = ${circle.members.rose}`);
    expect(await refusal()).toBe("no_parent");
    await db.admin.execute(sql`update members set status = 'active' where id = ${circle.members.rose}`);
    await withoutTriggers(db, (run) => run(sql`update shifts set checked_out_at = now() - interval '25 hours', checked_in_at = now() - interval '27 hours' where id = ${circle.shiftId}`));
    expect(await refusal()).toBe("expired");
  });

  it("tries at most twice, the second after a wait, and queues the second for later", async () => {
    const circle = await waitingForWord();
    const status = (shiftId: string, callSid: string | null, report: "answered" | "no_answer" | "failed", error?: string) =>
      service(circle.circleId, (tx) => recordCallStatus(tx, { circleId: circle.circleId, shiftId, callSid, status: report, error }));
    const first = await placed(circle, circle.shiftId);
    const ended = await status(circle.shiftId, first.callSid, "no_answer");
    expect(ended.state).toBe("no_answer");
    expect(ended.retryAt && ended.retryAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    const retries = await queued(db, circle.circleId, "shift.call");
    expect(retries).toHaveLength(2);
    expect(retries[1]?.availableAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    // A late or repeated report changes nothing and queues nothing.
    expect(await status(circle.shiftId, first.callSid, "failed")).toEqual({ state: "no_answer", retryAt: null });
    expect(await queued(db, circle.circleId, "shift.call")).toHaveLength(2);
    // Too soon for the second attempt, then the wait is over.
    const soon = await start(circle, circle.shiftId);
    expect(soon).toMatchObject({ kind: "refused", reason: "too_soon" });
    await pastTheWait();
    const second = await placed(circle, circle.shiftId);
    expect(second.call.attempt).toBe(2);
    // She picks up and puts the phone down without a word: the last attempt has failed.
    expect(await status(circle.shiftId, second.callSid, "answered")).toEqual({ state: "answered", retryAt: null });
    const failed = await status(circle.shiftId, second.callSid, "failed", "busy");
    expect(failed).toEqual({ state: "failed", retryAt: null });
    expect(await queued(db, circle.circleId, "shift.call")).toHaveLength(2);
    await pastTheWait();
    expect(await start(circle, circle.shiftId)).toEqual({ kind: "refused", reason: "attempts_exhausted", retryAt: null });
    const rows = await db.admin.execute<{ attempt: number; state: string; last_error: string | null }>(sql`select attempt, state, last_error from shift_calls where shift_id = ${circle.shiftId} order by attempt`);
    expect(rows.rows).toEqual([{ attempt: 1, state: "no_answer", last_error: null }, { attempt: 2, state: "failed", last_error: "busy" }]);
  });

  it("reports a dial that failed before the call had an ID, and moves a call only along its diagram", async () => {
    const circle = await waitingForWord();
    const call = await dial(circle, circle.shiftId);
    const report = (callSid: string | null, status: "answered" | "no_answer" | "failed") =>
      reason(service(circle.circleId, (tx) => recordCallStatus(tx, { circleId: circle.circleId, shiftId: circle.shiftId, callSid, status })));
    // Not yet placed, so it cannot be answered.
    expect(await report(null, "answered")).toBe("call_over");
    expect(await reason(service(circle.circleId, (tx) => recordCallPlaced(tx, { circleId: circle.circleId, shiftId: circle.shiftId, callId: randomUUID(), callSid: sid() })))).toBe("no_such_call");
    expect(await reason(service(circle.circleId, (tx) => recordCallPlaced(tx, { circleId: circle.circleId, shiftId: circle.shiftId, callId: call.callId, callSid: "not a sid" })))).toBe("invalid");
    expect(await report(null, "failed")).toBe("no error");
    expect(await report(sid(), "failed")).toBe("no_such_call");
    const row = await db.admin.execute<{ state: string; call_sid: string | null }>(sql`select state, call_sid from shift_calls where id = ${call.callId}`);
    expect(row.rows).toEqual([{ state: "failed", call_sid: null }]);
    // Placing a call twice with one ID changes nothing; another ID is refused.
    await pastTheWait();
    const again = await placed(circle, circle.shiftId);
    await service(circle.circleId, (tx) => recordCallPlaced(tx, { circleId: circle.circleId, shiftId: circle.shiftId, callId: again.call.callId, callSid: again.callSid }));
    expect(await reason(service(circle.circleId, (tx) => recordCallPlaced(tx, { circleId: circle.circleId, shiftId: circle.shiftId, callId: again.call.callId, callSid: sid() })))).toBe("call_over");
  });
});

describe("only Kin's service, for the circle it is scoped to, runs a call", () => {
  it("refuses every one of these to any person, whatever their role", async () => {
    const circle = await waitingForWord();
    const call = await placed(circle, circle.shiftId);
    const queries = [
      sql`select kin_private.start_shift_call(${circle.circleId}::uuid, ${circle.shiftId}::uuid)`,
      sql`select kin_private.record_call_placed(${circle.circleId}::uuid, ${circle.shiftId}::uuid, ${call.call.callId}::uuid, 'CA1')`,
      sql`select kin_private.record_call_status(${circle.circleId}::uuid, ${circle.shiftId}::uuid, ${call.callSid}, 'answered', null)`,
      sql`select kin_private.record_family_word_by_call(${circle.circleId}::uuid, ${circle.shiftId}::uuid, ${call.callSid}, 'yes')`,
    ];
    for (const userId of [circle.userId, circle.rose, circle.amara]) {
      for (const query of queries) expect(await errorCode(person(userId, (tx) => tx.execute(query)))).toBe(REFUSED.permission);
    }
    expect(await errorCode(db.provisioner.execute(queries[3] ?? sql`select 1`))).toBe(REFUSED.permission);
    expect((await shiftRow(circle.shiftId))?.state).toBe("checked_out");
  });

  it("refuses the service for any circle but the one in its scope, and with none in scope", async () => {
    const [mine, theirs] = [await waitingForWord(), await waitingForWord()];
    const call = await placed(theirs, theirs.shiftId);
    expect(await reason(service(mine.circleId, (tx) => startShiftCall(tx, { circleId: theirs.circleId, shiftId: theirs.shiftId })))).toBe("refused");
    expect(await reason(service(mine.circleId, (tx) => recordCallStatus(tx, { circleId: theirs.circleId, shiftId: theirs.shiftId, callSid: call.callSid, status: "answered" })))).toBe("refused");
    expect(await reason(service(mine.circleId, (tx) => recordFamilyWordByCall(tx, { circleId: theirs.circleId, shiftId: theirs.shiftId, callSid: call.callSid, answer: "yes" })))).toBe("refused");
    expect(await reason(service(mine.circleId, (tx) => recordCallPlaced(tx, { circleId: theirs.circleId, shiftId: theirs.shiftId, callId: call.call.callId, callSid: sid() })))).toBe("refused");
    expect(await reason(db.service.transaction((tx) => startShiftCall(tx, { circleId: mine.circleId, shiftId: mine.shiftId })))).toBe("refused");
    expect((await shiftRow(theirs.shiftId))?.state).toBe("checked_out");
  });
});

describe("the parent's spoken answer", () => {
  it("confirms the shift as the parent's own word, with the call as evidence, and queues its settling", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    expect(await word(circle, circle.shiftId, callSid, "yes")).toEqual({ outcome: "confirmed", recorded: true, shiftState: "confirmed" });
    expect(await shiftRow(circle.shiftId)).toEqual({ state: "confirmed", by: circle.members.rose, kind: "parent", evidence: callSid });
    expect((await db.admin.execute<{ state: string }>(sql`select state from shift_calls where call_sid = ${callSid}`)).rows).toEqual([{ state: "confirmed" }]);
    expect(await queued(db, circle.circleId, "shift.settle")).toMatchObject([{ payload: { shiftId: circle.shiftId } }]);
    const audit = await db.admin.execute<{ actor: string; member_id: string | null; origin: string; details: unknown }>(
      sql`select actor::text, member_id, origin, details from audit_log where action = 'shift.word_by_call' and subject_id = ${circle.shiftId}`,
    );
    expect(audit.rows).toMatchObject([{ actor: "service", member_id: null, origin: "phone", details: { callSid, parentMemberId: circle.members.rose } }]);
    expect(JSON.stringify(audit.rows)).not.toContain("5555550142");
    // Saying it again changes and queues nothing.
    expect(await word(circle, circle.shiftId, callSid, "yes")).toMatchObject({ outcome: "confirmed", recorded: false });
    expect(await queued(db, circle.circleId, "shift.settle")).toHaveLength(1);
  });

  it("is settled with nobody there to, and ends up as a person's own settling would", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    await word(circle, circle.shiftId, callSid, "yes");
    const settled = await service(circle.circleId, (tx) => settleShiftAsService(tx, { circleId: circle.circleId, shiftId: circle.shiftId }));
    expect(settled.cents).toBe(4400);
    const priced = await db.admin.execute<{ state: string; cents: string; worked: number; billable: number; rate: string; proposal: string }>(
      sql`select state::text, cents, worked_minutes as worked, billable_minutes as billable, rate_cents_per_hour as rate, proposal_id as proposal from shifts where id = ${circle.shiftId}`,
    );
    expect(priced.rows[0]).toMatchObject({ state: "priced", cents: "4400", worked: 120, billable: 120, rate: "2200", proposal: settled.proposalId });
    const audit = await db.admin.execute<{ actor: string; member_id: string | null; origin: string }>(sql`select actor::text, member_id, origin from audit_log where action = 'shift.priced' and subject_id = ${circle.shiftId}`);
    expect(audit.rows).toEqual([{ actor: "service", member_id: null, origin: "worker" }]);
    expect(await service(circle.circleId, (tx) => settleShiftAsService(tx, { circleId: circle.circleId, shiftId: circle.shiftId }))).toMatchObject({ proposalId: settled.proposalId });
  });

  it("records nothing for an unclear answer", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    expect(await word(circle, circle.shiftId, callSid, "unclear")).toEqual({ outcome: "unclear", recorded: false, shiftState: "checked_out" });
    expect(await shiftRow(circle.shiftId)).toEqual({ state: "checked_out", by: null, kind: null, evidence: null });
    expect((await db.admin.execute<{ state: string }>(sql`select state from shift_calls where call_sid = ${callSid}`)).rows).toEqual([{ state: "calling" }]);
    expect(await queued(db, circle.circleId, "shift.settle")).toEqual([]);
    // She can still say yes on the same call.
    expect(await word(circle, circle.shiftId, callSid, "yes")).toMatchObject({ outcome: "confirmed", recorded: true });
  });

  it("records a no as a declined call and pays nothing, and Kin does not call again", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    expect(await word(circle, circle.shiftId, callSid, "no")).toEqual({ outcome: "declined", recorded: true, shiftState: "checked_out" });
    expect(await shiftRow(circle.shiftId)).toEqual({ state: "checked_out", by: null, kind: null, evidence: null });
    expect(await queued(db, circle.circleId, "shift.settle")).toEqual([]);
    expect(await reason(word(circle, circle.shiftId, callSid, "yes"))).toBe("call_over");
    await pastTheWait();
    expect(await start(circle, circle.shiftId)).toEqual({ kind: "refused", reason: "declined", retryAt: null });
    const audit = await db.admin.execute(sql`select 1 from audit_log where action = 'shift.word_declined_by_call' and subject_id = ${circle.shiftId}`);
    expect(audit.rows).toHaveLength(1);
  });

  it("is recorded only on a call Kin placed for this shift", async () => {
    const circle = await waitingForWord();
    const other = await openAideShift(db, circle);
    await person(circle.amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId: other, now: new Date() }));
    const { callSid } = await placed(circle, circle.shiftId);
    expect(await reason(word(circle, circle.shiftId, sid(), "yes"))).toBe("no_such_call");
    expect(await reason(word(circle, other, callSid, "yes"))).toBe("no_such_call");
    expect(await reason(word(circle, circle.shiftId, callSid, "maybe" as "yes"))).toBe("invalid");
    expect(await reason(word(circle, circle.shiftId, "x'; --", "yes"))).toBe("invalid");
    expect((await shiftRow(other))?.state).toBe("checked_out");
    expect((await shiftRow(circle.shiftId))?.state).toBe("checked_out");
  });

  it("cannot be put in the mouth of someone who is no longer the circle's parent, or when the call has been switched off", async () => {
    const left = await waitingForWord();
    const leftCall = await placed(left, left.shiftId);
    await db.admin.execute(sql`update members set status = 'left' where id = ${left.members.rose}`);
    expect(await reason(word(left, left.shiftId, leftCall.callSid, "yes"))).toBe("refused");
    expect(await shiftRow(left.shiftId)).toEqual({ state: "checked_out", by: null, kind: null, evidence: null });

    const off = await waitingForWord();
    const offCall = await placed(off, off.shiftId);
    await person(off.userId, (tx) => setParentCallSettings(tx, { circleId: off.circleId, phone: null, enabled: false, consent: false }));
    expect(await reason(word(off, off.shiftId, offCall.callSid, "yes"))).toBe("refused");
    expect((await shiftRow(off.shiftId))?.state).toBe("checked_out");
  });

  it("never overwrites a word already given, and holds the evidence with it", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    // Her family's word comes first, on a screen, while the call is still going.
    await person(circle.rose, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId: circle.shiftId, now: new Date() }));
    const before = await shiftRow(circle.shiftId);
    expect(before).toMatchObject({ state: "priced", kind: "parent", evidence: null });
    expect(await word(circle, circle.shiftId, callSid, "yes")).toMatchObject({ outcome: "already_in", recorded: false });
    expect(await shiftRow(circle.shiftId)).toEqual(before);

    const spoken = await waitingForWord();
    const spokenCall = await placed(spoken, spoken.shiftId);
    await word(spoken, spoken.shiftId, spokenCall.callSid, "yes");
    const given = await shiftRow(spoken.shiftId);
    expect(await errorCode(db.admin.execute(sql`update shifts set family_evidence_ref = 'CAother' where id = ${spoken.shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update shifts set family_confirmed_by = ${spoken.members.marcus} where id = ${spoken.shiftId}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update shifts set family_confirmation = 'sibling' where id = ${spoken.shiftId}`))).toBe(REFUSED.restrict);
    // A sibling's later confirmation, or a second call's word, changes nothing.
    expect(await reason(person(spoken.userId, (tx) => confirmShift(tx, { circleId: spoken.circleId, shiftId: spoken.shiftId, now: new Date() })))).toBe("parent_can_answer");
    expect(await shiftRow(spoken.shiftId)).toEqual(given);
    // The evidence is only ever stored with a word.
    const open = await openAideShift(db, spoken);
    expect(await errorCode(db.admin.execute(sql`update shifts set family_evidence_ref = 'CA1' where id = ${open}`))).toBe(REFUSED.check);
  });

  it("is refused for a cancelled shift, and for a demo circle, and records nothing", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    await person(circle.amara, (tx) => cancelShift(tx, { circleId: circle.circleId, shiftId: circle.shiftId }));
    expect(await reason(word(circle, circle.shiftId, callSid, "yes"))).toBe("wrong_state");
    expect((await shiftRow(circle.shiftId))?.state).toBe("cancelled");

    const demo = await waitingForWord();
    const demoCall = await placed(demo, demo.shiftId);
    await db.admin.execute(sql`update circles set demo = true where id = ${demo.circleId}`);
    expect(await reason(word(demo, demo.shiftId, demoCall.callSid, "yes"))).toBe("refused");
    expect((await shiftRow(demo.shiftId))?.state).toBe("checked_out");
  });
});

describe("the call's state in the circle's records", () => {
  it("shows those who see the circle's money how the latest call went, and a caregiver nothing of it", async () => {
    const circle = await waitingForWord();
    const { callSid } = await placed(circle, circle.shiftId);
    await word(circle, circle.shiftId, callSid, "no");
    const stateOf = async (userId: string) => (await snapshotFor(db, userId, circle.circleId)).shifts.find((shift) => shift.id === circle.shiftId)?.callState;
    expect(await stateOf(circle.userId)).toBe("declined");
    expect(await stateOf(circle.rose)).toBe("declined");
    expect(await stateOf(circle.amara)).toBeNull();
    expect(await errorCode(person(circle.userId, (tx) => tx.execute(sql`select call_sid from shift_calls`)))).toBe(REFUSED.permission);
    const hidden = await person(circle.amara, (tx) => tx.execute(sql`select state from shift_calls`));
    expect(hidden.rows).toEqual([]);
  });
});
