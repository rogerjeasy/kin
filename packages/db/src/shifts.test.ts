import { priceShift, type ShiftPermissionTerms } from "@kin/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { grantShiftPermission, shiftPermissionDigest } from "./shift-permissions.ts";
import { ShiftError, cancelShift, checkInShift, checkOutShift, confirmShift, scheduleShift, setOwnPayoutTarget, setShiftRules, settleShift } from "./shifts.ts";
import { asPerson, asService } from "./scope.ts";
import { seatPerson, snapshotFor, visitorWithCircle } from "./testing/index.ts";
import { testDatabases } from "./testing/databases.ts";
import { CLOCK, newShift, payAsWorker } from "./testing/shifts.ts";

const db = testDatabases();

/** Runs `work` as a person, with the circle ID beside it only to read well at the call. */
const as = <T>(userId: string, _circleId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const rows = async (circleId: string, query: string, params: readonly unknown[] = []) => {
  const parts = query.split(/\$(\d+)/);
  const built = sql.join(parts.map((part, index) => (index % 2 === 0 ? sql.raw(part) : sql`${params[Number(part) - 1]}`)), sql.raw(""));
  return (await asService(db.service, circleId, async (tx) => (await tx.execute<Record<string, unknown>>(built)).rows));
};

async function setup() {
  const circle = await visitorWithCircle(db);
  const amara = await seatPerson(db, circle.circleId, circle.members.amara);
  return { circle, amara, elena: circle.userId, ids: { circleId: circle.circleId } };
}

describe("a shift paid by the parent's standing permission", () => {
  it("waits on either key alone, then turns into an approved payout to the caregiver's Venmo when both have turned, and is paid only when PayPal's record says so", async () => {
    const { circle, amara, elena } = await setup();
    const circleId = circle.circleId;
    await as(amara, circleId, (tx) => setOwnPayoutTarget(tx, { circleId, receiver: "@amara-demo", wallet: "venmo" }));
    const shiftId = await newShift(db, circle);

    await as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId }));
    const out = await as(amara, circleId, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
    // The caregiver's key alone: pending, nothing paid, nothing proposed.
    expect(out).toEqual({ settled: null, held: null });
    expect(await rows(circleId, "select state, proposal_id from shifts where id = $1", [shiftId])).toEqual([{ state: "checked_out", proposal_id: null }]);
    const waiting = (await snapshotFor(db, elena, circleId)).shifts.find((each) => each.id === shiftId);
    expect(waiting).toMatchObject({ state: "checked_out", waitingFor: "family_word", simulated: true });

    const confirmed = await as(elena, circleId, (tx) => confirmShift(tx, { circleId, shiftId, now: CLOCK }));
    // Check-out at the planned end, two hours after the demo clock's check-in: 120 minutes at 22.00 an hour.
    expect(confirmed.settled).toMatchObject({ outcome: "paid_by_permission", askReason: null, cents: 4400 });
    const settled = confirmed.settled;
    if (!settled?.permissionId) throw new Error("not settled by a permission");

    const [proposal] = await rows(circleId, "select state, cents::int as cents, purpose, kind, raised_by, plan from proposals where id = $1", [settled.proposalId]);
    expect(proposal).toMatchObject({ state: "approved", cents: 4400, purpose: "shift", kind: "caregiver_payout", raised_by: null });
    expect(await rows(circleId, "select method, role, evidence_ref from approvals where proposal_id = $1", [settled.proposalId])).toEqual([
      { method: "mandate", role: "parent", evidence_ref: `shift_permission:${settled.permissionId}` },
    ]);
    expect(await rows(circleId, "select receiver, wallet, state from executions where proposal_id = $1", [settled.proposalId])).toEqual([{ receiver: "@amara-demo", wallet: "venmo", state: "created" }]);
    expect(await rows(circleId, "select topic from outbox where circle_id = $1 and payload ->> 'executionId' in (select id::text from executions where proposal_id = $2)", [circleId, settled.proposalId])).toEqual([{ topic: "payout.execute" }]);
    expect(await rows(circleId, "select s.state, u.cents::int as cents, u.minutes from shifts s join shift_permission_uses u on u.shift_id = s.id where s.id = $1", [shiftId])).toEqual([{ state: "priced", cents: 4400, minutes: 120 }]);

    await payAsWorker(db, circleId, settled.proposalId);
    expect(await rows(circleId, "select state from shifts where id = $1", [shiftId])).toEqual([{ state: "paid" }]);
    expect(await rows(circleId, "select state from proposals where id = $1", [settled.proposalId])).toEqual([{ state: "settled" }]);
    expect(await rows(circleId, "select action from audit_log where subject_id = $1 and action = 'shift.paid'", [shiftId])).toHaveLength(1);
    // Paid is recorded once.
    expect(await rows(circleId, "select count(*)::int as n from ledger_entries where source_id = $1", [`test-item-${(await rows(circleId, "select id from executions where proposal_id = $1", [settled.proposalId]))[0]?.id}`])).toEqual([{ n: 1 }]);
  });

  it("is settled the same when the family's word comes first, by the caregiver's own check-out", async () => {
    const { circle, amara, elena } = await setup();
    const circleId = circle.circleId;
    const shiftId = await newShift(db, circle);
    await as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId }));
    // The word while the visit is under way: still pending.
    const early = await as(elena, circleId, (tx) => confirmShift(tx, { circleId, shiftId, now: CLOCK }));
    expect(early).toEqual({ settled: null, held: null });
    expect(await rows(circleId, "select state, family_confirmation from shifts where id = $1", [shiftId])).toEqual([{ state: "checked_in", family_confirmation: "sibling" }]);
    const last = await as(amara, circleId, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
    expect(last.settled).toMatchObject({ outcome: "paid_by_permission", cents: 4400 });
  });

  it("puts a shift outside the permission to the family, with the reason, as an ordinary caregiver payout it answers", async () => {
    const { circle, amara, elena } = await setup();
    const circleId = circle.circleId;
    // Five hours against a limit of four hours a day.
    const shiftId = await newShift(db, circle, { endsAt: "2026-10-30T23:00:00Z" });
    await as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId }));
    await as(amara, circleId, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
    const turn = await as(elena, circleId, (tx) => confirmShift(tx, { circleId, shiftId, now: CLOCK }));
    expect(turn.settled).toMatchObject({ outcome: "asks_family", permissionId: null, askReason: "over_daily_hours", cents: 11000 });
    const [proposal] = await rows(circleId, "select state, plan, raised_by from proposals where id = $1", [turn.settled?.proposalId]);
    expect(proposal).toMatchObject({ state: "pending_approval", raised_by: null });
    expect(proposal?.plan).toMatchObject({ outcome: "needs_approval", payeeMemberId: circle.members.amara });
    expect(await rows(circleId, "select count(*)::int as n from executions where proposal_id = $1", [turn.settled?.proposalId])).toEqual([{ n: 0 }]);
    // The caregiver sees her own pending payment, and the shift says it is priced.
    const seen = await snapshotFor(db, amara, circleId);
    expect(seen.shifts.find((each) => each.id === shiftId)).toMatchObject({ state: "priced", proposalState: "pending_approval", permissionId: null });
  });

  it("repeats every step without changing anything, and refuses the same key for other facts", async () => {
    const { circle, amara, elena } = await setup();
    const circleId = circle.circleId;
    const id = randomUUID();
    const input = { circleId, id, kind: "aide" as const, memberId: circle.members.amara, title: "Care", startsAt: new Date("2026-10-30T14:00:00Z"), endsAt: new Date("2026-10-30T20:00:00Z") };
    await as(elena, circleId, (tx) => scheduleShift(tx, input));
    await as(elena, circleId, (tx) => scheduleShift(tx, input));
    await expect(as(elena, circleId, (tx) => scheduleShift(tx, { ...input, title: "Other" }))).rejects.toMatchObject({ reason: "key_reused" });
    await as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId: id }));
    await as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId: id }));
    await as(amara, circleId, (tx) => checkOutShift(tx, { circleId, shiftId: id, now: CLOCK }));
    await as(amara, circleId, (tx) => checkOutShift(tx, { circleId, shiftId: id, now: CLOCK }));
    const first = await as(elena, circleId, (tx) => confirmShift(tx, { circleId, shiftId: id, now: CLOCK }));
    const again = await as(elena, circleId, (tx) => confirmShift(tx, { circleId, shiftId: id, now: CLOCK }));
    expect(again.settled?.proposalId).toBeUndefined();
    const settledAgain = await as(elena, circleId, (tx) => settleShift(tx, { circleId, shiftId: id }));
    expect(settledAgain.proposalId).toBe(first.settled?.proposalId);
    expect(await rows(circleId, "select count(*)::int as n from proposals where purpose = 'shift' and cents = 4400 and id = $1", [first.settled?.proposalId])).toEqual([{ n: 1 }]);
    expect(await rows(circleId, "select count(*)::int as n from shifts where id = $1", [id])).toEqual([{ n: 1 }]);
    // A shift that is cancelled stays so, and cancelling again changes nothing.
    const other = await newShift(db, circle);
    await as(elena, circleId, (tx) => cancelShift(tx, { circleId, shiftId: other }));
    await as(elena, circleId, (tx) => cancelShift(tx, { circleId, shiftId: other }));
    await expect(as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId: other }))).rejects.toMatchObject({ reason: "wrong_state" });
  });
});

describe("what a shift is worth", () => {
  it("is the same figure the money core computes, for a spread of minutes, rates, minimums and overtime", async () => {
    const { circle, elena } = await setup();
    const circleId = circle.circleId;
    const payeeId = circle.payees.amara;
    const cases: { minutes: number; rate: number; min: number; after: number | null; percent: number }[] = [];
    for (const minutes of [1, 29, 30, 59, 60, 61, 119, 240, 479, 480, 481, 600, 1440]) {
      for (const [rate, min, after, percent] of [[2200, 0, null, 150], [1999, 60, 480, 150], [1, 90, 120, 100], [3333, 45, 240, 175], [9001, 0, 60, 300]] as const) {
        cases.push({ minutes, rate, min, after, percent });
      }
    }
    let checked = 0;
    for (const [index, each] of cases.entries()) {
      if (each.minutes === 1 && each.rate === 1) continue;
      await as(elena, circleId, (tx) => setShiftRules(tx, { circleId, payeeId, minimumMinutes: each.min, overtimeAfterMinutes: each.after, overtimePercent: each.percent }));
      await db.admin.execute(sql`update payees set caregiver_rate_cents_per_hour = ${each.rate} where id = ${payeeId}`);
      const shiftId = randomUUID();
      const start = new Date(Date.UTC(2026, 0, 1 + index, 8, 0, 0));
      const end = new Date(start.getTime() + each.minutes * 60_000 + (each.minutes === 1440 ? 0 : 59_000));
      // Whole minutes only: the 59 spare seconds are never paid.
      await db.admin.execute(sql`insert into shifts (id, circle_id, kind, member_id, payee_id, starts_at, ends_at, state, checked_in_at, checked_out_at, family_confirmed_by, family_confirmed_at, family_confirmation, created_by)
        values (${shiftId}, ${circleId}, 'aide', ${circle.members.amara}, ${payeeId}, ${start.toISOString()}, ${end.toISOString()}, 'confirmed', ${start.toISOString()}, ${end.toISOString()}, ${circle.members.rose}, ${end.toISOString()}, 'parent', ${circle.members.elena})`);
      const price = priceShift(start, end, { rateCentsPerHour: each.rate, minimumMinutes: each.min, overtimeAfterMinutes: each.after, overtimePercent: each.percent });
      // Nothing to pay, or more than the agreement's ceiling of 3000.00, is refused before it is priced.
      if (price.cents <= 0 || price.cents > 300_000) continue;
      await as(elena, circleId, (tx) => settleShift(tx, { circleId, shiftId }));
      expect(await rows(circleId, "select worked_minutes, billable_minutes, cents::int as cents, rate_cents_per_hour::int as rate from shifts where id = $1", [shiftId])).toEqual([
        { worked_minutes: price.workedMinutes, billable_minutes: price.billableMinutes, cents: price.cents, rate: each.rate },
      ]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("is refused for rules the domain would not price by", async () => {
    const { circle, elena } = await setup();
    const circleId = circle.circleId;
    const payeeId = circle.payees.amara;
    for (const rules of [{ minimumMinutes: -1, overtimeAfterMinutes: null, overtimePercent: 150 }, { minimumMinutes: 0, overtimeAfterMinutes: 0, overtimePercent: 150 }, { minimumMinutes: 0, overtimeAfterMinutes: null, overtimePercent: 99 }, { minimumMinutes: 1441, overtimeAfterMinutes: null, overtimePercent: 150 }]) {
      await expect(as(elena, circleId, (tx) => setShiftRules(tx, { circleId, payeeId, ...rules }))).rejects.toMatchObject({ reason: "invalid" });
    }
  });
});

describe("the parent's standing permission", () => {
  const terms = (payeeId: string): ShiftPermissionTerms => ({ payeeId, maxMinutesPerDay: 180, perShiftCents: 9000, validFrom: "2026-10-30", expiresOn: "2027-04-30" });

  it("is sealed by a digest the code recomputes exactly as the database does, for a granted and a seeded one", async () => {
    const { circle, elena } = await setup();
    const circleId = circle.circleId;
    const id = randomUUID();
    const granted = terms(circle.payees.amara);
    await as(elena, circleId, (tx) => grantShiftPermission(tx, { circleId, id, terms: granted, spokenText: "Up to three hours.", now: CLOCK }));
    const [row] = await rows(circleId, "select digest, simulated, granted_by, recorded_by from shift_permissions where id = $1", [id]);
    expect(row).toMatchObject({ digest: shiftPermissionDigest(granted), simulated: true, granted_by: circle.members.rose, recorded_by: circle.members.elena });
    const [sql_digest] = (await db.admin.execute<{ d: string }>(sql`select encode(sha256(convert_to(jsonb_build_array(${granted.payeeId}::text, ${granted.maxMinutesPerDay}::integer, ${granted.perShiftCents}::bigint, ${granted.validFrom}::date::text, ${granted.expiresOn}::date::text)::text, 'UTF8')), 'hex') as d`)).rows;
    expect(sql_digest?.d).toBe(shiftPermissionDigest(granted));
    for (const seeded of (await snapshotFor(db, elena, circleId)).shiftPermissions) {
      expect(seeded.digest).toBe(shiftPermissionDigest({ payeeId: seeded.payeeId, maxMinutesPerDay: seeded.maxMinutesPerDay, perShiftCents: seeded.perShiftCents, validFrom: seeded.validFrom, expiresOn: seeded.expiresOn }));
    }
    // The same key again grants it once; the same key for other terms is refused.
    await as(elena, circleId, (tx) => grantShiftPermission(tx, { circleId, id, terms: granted, spokenText: null, now: CLOCK }));
    await expect(as(elena, circleId, (tx) => grantShiftPermission(tx, { circleId, id, terms: { ...granted, perShiftCents: 8000 }, spokenText: null, now: CLOCK }))).rejects.toMatchObject({ reason: "key_reused" });
  });

  it("is the seeded one, live, for Amara, with the shifts around it", async () => {
    const { circle, elena } = await setup();
    const seen = await snapshotFor(db, elena, circle.circleId);
    expect(seen.shiftPermissions).toHaveLength(1);
    expect(seen.shiftPermissions[0]).toMatchObject({ payeeId: circle.payees.amara, maxMinutesPerDay: 240, perShiftCents: 15000, status: "active", simulated: true, grantedBy: circle.members.rose });
    expect(seen.shiftRules).toEqual([{ payeeId: circle.payees.amara, minimumMinutes: 60, overtimeAfterMinutes: 480, overtimePercent: 150, payoutWallet: "paypal" }]);
    expect(seen.shifts.filter((each) => each.state === "paid")).toHaveLength(2);
    expect(seen.shifts.filter((each) => each.state === "scheduled").map((each) => each.kind).toSorted()).toEqual(["aide", "aide", "appointment", "drive", "visit"]);
  });

  it("is refused above the agreement's ceiling, for the wrong terms, and after it has ended is never revived", async () => {
    const { circle, elena } = await setup();
    const circleId = circle.circleId;
    const base = terms(circle.payees.amara);
    await expect(as(elena, circleId, (tx) => grantShiftPermission(tx, { circleId, id: randomUUID(), terms: { ...base, perShiftCents: 400_000 }, spokenText: null, now: CLOCK }))).rejects.toMatchObject({ reason: "above_ceiling" });
    await expect(as(elena, circleId, (tx) => grantShiftPermission(tx, { circleId, id: randomUUID(), terms: { ...base, maxMinutesPerDay: 0 }, spokenText: null, now: CLOCK }))).rejects.toBeInstanceOf(ShiftError);
    // Straight to the database, past the code's own check: the ceiling still holds.
    const code = await as(elena, circleId, (tx) => tx.execute(sql`select kin_private.grant_shift_permission(${circleId}::uuid, ${randomUUID()}::uuid, ${base.payeeId}::uuid, 60, 400000::bigint, '2026-10-30'::date, '2027-01-01'::date, null)`)).catch((error: unknown) => (error as { cause?: { code?: string } }).cause?.code);
    expect(code).toBe("KB006");
  });
});

describe("where a caregiver's pay lands", () => {
  it("takes a PayPal email, or a Venmo email, phone or handle, and nothing else", async () => {
    const { circle, amara } = await setup();
    const circleId = circle.circleId;
    // Amara's week waits for Rose; the target may be replaced freely only once no payment waits.
    await db.admin.execute(sql`update proposals set state = 'cancelled' where payee_id = ${circle.payees.amara} and state = 'pending_approval'`);
    const set = (receiver: string, wallet: "paypal" | "venmo") => as(amara, circleId, (tx) => setOwnPayoutTarget(tx, { circleId, receiver, wallet }));
    await set(" Amara@Example.com ", "paypal");
    await set("@amara_b", "venmo");
    await set("+15551234567", "venmo");
    await set("amara@example.com", "venmo");
    for (const [receiver, wallet] of [["@amara_b", "paypal"], ["not-a-target", "venmo"], ["@a", "venmo"], ["12345", "venmo"], ["+447700900123", "venmo"], ["", "paypal"]] as const) {
      await expect(set(receiver, wallet)).rejects.toMatchObject({ reason: "invalid_target" });
    }
    expect(await rows(circleId, "select paypal_receiver, payout_wallet from payees where id = $1", [circle.payees.amara])).toEqual([{ paypal_receiver: "amara@example.com", payout_wallet: "venmo" }]);
  });

  it("is fixed on the execution when the family's yes queues it, and cannot change while that payment is in progress", async () => {
    const { circle, amara, elena } = await setup();
    const circleId = circle.circleId;
    await as(amara, circleId, (tx) => setOwnPayoutTarget(tx, { circleId, receiver: "@amara_b", wallet: "venmo" }));
    const shiftId = await newShift(db, circle);
    await as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId }));
    await as(amara, circleId, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
    const { settled } = await as(elena, circleId, (tx) => confirmShift(tx, { circleId, shiftId, now: CLOCK }));
    expect(settled?.outcome).toBe("paid_by_permission");
    await expect(as(amara, circleId, (tx) => setOwnPayoutTarget(tx, { circleId, receiver: "amara@example.com", wallet: "paypal" }))).rejects.toMatchObject({ reason: "payment_in_progress" });
    // Even past the operation, the execution's wallet and receiver cannot be pointed elsewhere.
    await expect(rows(circleId, "update executions set wallet = 'paypal' where proposal_id = $1", [settled?.proposalId])).rejects.toMatchObject({ cause: { code: "23001" } });
    await expect(rows(circleId, "update executions set receiver = 'x@example.com' where proposal_id = $1", [settled?.proposalId])).rejects.toMatchObject({ cause: { code: "23001" } });
  });
});

describe("tapping in on a real visit", () => {
  it("is allowed only around the time the visit was planned for, so a tap cannot be made weeks ahead or long after", async () => {
    const { circle, amara } = await setup();
    const circleId = circle.circleId;
    // A real circle runs on the real clock and has no demo window.
    await db.admin.execute(sql`update circles set demo = false, clock_at = null where id = ${circleId}`);
    const hour = 60 * 60 * 1000;
    const at = (offsetHours: number) => new Date(Date.now() + offsetHours * hour).toISOString();
    const tapIn = (shiftId: string) => as(amara, circleId, (tx) => checkInShift(tx, { circleId, shiftId }));
    const nextWeek = await newShift(db, circle, { startsAt: at(7 * 24), endsAt: at(7 * 24 + 4) });
    await expect(tapIn(nextWeek)).rejects.toMatchObject({ reason: "not_started" });
    const longAgo = await newShift(db, circle, { startsAt: at(-30), endsAt: at(-26) });
    await expect(tapIn(longAgo)).rejects.toMatchObject({ reason: "wrong_state" });
    const now = await newShift(db, circle, { startsAt: at(-1), endsAt: at(3) });
    await tapIn(now);
    expect(await rows(circleId, "select state from shifts where id = $1", [now])).toEqual([{ state: "checked_in" }]);
    // Early arrival within two hours of the start still counts.
    const soon = await newShift(db, circle, { startsAt: at(1.5), endsAt: at(5.5) });
    await tapIn(soon);
  });
});
