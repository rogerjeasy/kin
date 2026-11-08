import { asPerson, readCircle, type CircleSnapshot } from "@kin/db";
import { seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import { latestPaid, needsOf, shiftViews } from "@/content/circle/shift-views";
import { shiftWeek } from "@/content/circle/shift-week";

import { runShift, type ShiftContext, type ShiftResult } from "./shifts";
import { payAsWorker } from "../../../../packages/db/src/testing/shifts.ts";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));
const context = (circle: CircleSnapshot, userId: string): ShiftContext => ({ db: db.app, userId, circle });
/** Runs one operation as a persona of the circle, on a snapshot read just before. */
async function as(circle: VisitorCircle, persona: keyof VisitorCircle["members"], input: unknown, change?: (seen: CircleSnapshot) => CircleSnapshot): Promise<ShiftResult> {
  const userId = persona === "elena" ? circle.userId : await seatPerson(db, circle.circleId, circle.members[persona]);
  const seen = await snapshot(circle, userId);
  return runShift(context(change ? change(seen) : seen, userId), input);
}
const todaysShift = async (circle: VisitorCircle): Promise<string> => {
  const seen = await snapshot(circle, circle.userId);
  const found = seen.shifts.find((shift) => shift.kind === "aide" && shift.state === "scheduled" && shift.startsAt.toISOString() === "2026-10-30T14:00:00.000Z");
  if (!found) throw new Error("The demo has no aide shift today");
  return found.id;
};
const permissionDraft = (seen: CircleSnapshot, change: Record<string, unknown> = {}) => ({
  payeeId: seen.payees.find((payee) => payee.caregiverRateCentsPerHour !== null)?.id,
  maxHours: "4",
  perShift: "150.00",
  validFrom: "2026-10-30",
  expiresOn: "2027-03-31",
  ...change,
});

describe("who may do what with a shift, refused first", () => {
  it("refuses an observer every operation, and says nothing is changed", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const seen = await snapshot(circle, circle.userId);
    const payeeId = seen.payees.find((payee) => payee.caregiverRateCentsPerHour !== null)?.id;
    for (const input of [
      { operation: "schedule", kind: "visit", memberId: circle.members.ana, date: "2026-11-05", start: "09:00", end: "10:00" },
      { operation: "check_in", shiftId },
      { operation: "confirm", shiftId },
      { operation: "cancel", shiftId },
      { operation: "rules", payeeId, minimumMinutes: 30, overtimeAfterHours: null, overtimePercent: 150 },
      { operation: "target", wallet: "venmo", receiver: "@daniel-d" },
      { operation: "review_permission", draft: permissionDraft(seen) },
      { operation: "grant_permission", draft: permissionDraft(seen) },
    ]) {
      expect(await as(circle, "daniel", input), JSON.stringify(input)).toEqual({ ok: false, reason: "refused" });
    }
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from shifts where circle_id = $1 and state <> 'scheduled'", [circle.circleId])).toEqual([{ n: 2 }]);
  });

  it("refuses a caregiver the family's word, their own shift's and everyone's, and the calendar, rules and permissions", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const seen = await snapshot(circle, circle.userId);
    const payeeId = seen.payees.find((payee) => payee.caregiverRateCentsPerHour !== null)?.id;
    for (const input of [
      { operation: "confirm", shiftId },
      { operation: "schedule", kind: "aide", memberId: circle.members.amara, date: "2026-11-05", start: "09:00", end: "10:00" },
      { operation: "rules", payeeId, minimumMinutes: 0, overtimeAfterHours: null, overtimePercent: 150 },
      { operation: "grant_permission", draft: permissionDraft(seen) },
      { operation: "pause_permission", permissionId: seen.shiftPermissions[0]?.id },
    ]) {
      expect(await as(circle, "amara", input), JSON.stringify(input)).toEqual({ ok: false, reason: "refused" });
    }
  });

  it("lets a sibling give the family's word only where the parent cannot, and never for their own visit", async () => {
    const circle = await visitorWithCircle(db);
    const amaraShift = await todaysShift(circle);
    expect(await as(circle, "amara", { operation: "check_in", shiftId: amaraShift })).toMatchObject({ ok: true });
    // In a real circle whose parent decides, a sibling's word is not asked for.
    const real = (seen: CircleSnapshot): CircleSnapshot => ({ ...seen, circle: { ...seen.circle, demo: false } });
    expect(await as(circle, "marcus", { operation: "confirm", shiftId: amaraShift }, real)).toEqual({ ok: false, reason: "parent_can_answer" });
    expect(needsOf(await snapshot(circle, await seatPerson(db, circle.circleId, circle.members.rose))).map((need) => need.kind)).toEqual(["word"]);
    // Ana cannot confirm a visit of her own, whoever she is.
    const visit = (await snapshot(circle, circle.userId)).shifts.find((shift) => shift.kind === "visit");
    expect(await as(circle, "ana", { operation: "confirm", shiftId: visit?.id })).toEqual({ ok: false, reason: "own_shift" });
    // A shift nobody gave her to see is not hers to turn.
    expect(await as(circle, "amara", { operation: "check_in", shiftId: visit?.id })).toEqual({ ok: false, reason: "refused" });
  });
});

describe("two keys turn a shift", () => {
  it("is paid at once by the standing permission once Amara has tapped out and Rose has said yes, and Amara is told", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);

    expect(await as(circle, "amara", { operation: "check_in", shiftId })).toEqual({ ok: true, id: shiftId });
    // The caregiver's key alone leaves it waiting for the family.
    expect(await as(circle, "amara", { operation: "check_out", shiftId })).toEqual({ ok: true, outcome: { kind: "waiting" } });
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    expect(needsOf(await snapshot(circle, rose)).map((need) => [need.kind, need.part])).toEqual([["word", "morning"]]);

    const answered = await runShift(context(await snapshot(circle, rose), rose), { operation: "confirm", shiftId });
    // Planned 10:00 to 12:00 in New York: 2 hours at 22.00.
    expect(answered).toEqual({ ok: true, outcome: { kind: "paid_by_permission", cents: 4400 } });
    const [view] = shiftViews(await snapshot(circle, rose), shiftWeek(await snapshot(circle, rose), "2026-10-30")).filter((each) => each.shift.id === shiftId);
    expect(view).toMatchObject({ tone: "ready", chip: "being_paid", payment: "sending", byPermission: true, keys: { caregiver: true, family: true, both: true } });
    expect(view?.shift).toMatchObject({ cents: 4400, billableMinutes: 120, rateCentsPerHour: 2200, simulated: true });

    // The worker pays it; Amara's screen then shows the payment that came in.
    const proposalId = String((await serviceRows(db, circle.circleId, "select proposal_id from shifts where id = $1", [shiftId]))[0]?.proposal_id);
    await payAsWorker(db, circle.circleId, proposalId);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const paid = latestPaid(await snapshot(circle, amara));
    expect(paid).toMatchObject({ tone: "paid", chip: "paid", payment: "paid", shift: { id: shiftId, cents: 4400 } });
    expect(needsOf(await snapshot(circle, amara))).toEqual([]);
  });

  it("goes to the family for approval when it is above the permission, and says why", async () => {
    const circle = await visitorWithCircle(db);
    // Eight hours, from 10:00 to 18:00 in New York: 176.00, above the 150.00 a shift the permission allows.
    const scheduled = await as(circle, "elena", { operation: "schedule", kind: "aide", memberId: circle.members.amara, title: "Long day", date: "2026-10-30", start: "14:00", end: "22:00" });
    if (!scheduled.ok || !("id" in scheduled)) throw new Error("not scheduled");
    const shiftId = scheduled.id;
    await as(circle, "amara", { operation: "check_in", shiftId });
    await as(circle, "amara", { operation: "check_out", shiftId });
    const confirmed = await as(circle, "rose", { operation: "confirm", shiftId });
    expect(confirmed).toEqual({ ok: true, outcome: { kind: "asks_family", cents: 17600, askReason: "above_per_shift" } });
    const seen = await snapshot(circle, circle.userId);
    expect(shiftViews(seen, shiftWeek(seen, "2026-10-30")).find((view) => view.shift.id === shiftId)).toMatchObject({ chip: "awaits_approval", payment: "waiting_family", byPermission: false });
    expect(seen.proposals.find((proposal) => proposal.purpose === "shift" && proposal.state === "pending_approval")).toMatchObject({ cents: 17600 });
  });

  it("holds a settled shift when the circle is paused, without undoing Rose's word", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    await as(circle, "amara", { operation: "check_in", shiftId });
    await as(circle, "amara", { operation: "check_out", shiftId });
    await serviceRows(db, circle.circleId, "update circles set paused_until = $2, paused_by = $3 where id = $1", [circle.circleId, new Date(CLOCK.getTime() + 3_600_000), circle.members.elena]);
    expect(await as(circle, "rose", { operation: "confirm", shiftId })).toEqual({ ok: true, outcome: { kind: "held", reason: "paused" } });
    expect((await snapshot(circle, circle.userId)).shifts.find((shift) => shift.id === shiftId)).toMatchObject({ state: "confirmed", waitingFor: null });
  });

  it("says why a move the diagram does not draw is refused", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    expect(await as(circle, "amara", { operation: "check_out", shiftId })).toEqual({ ok: false, reason: "wrong_state" });
    expect(await as(circle, "rose", { operation: "confirm", shiftId })).toEqual({ ok: false, reason: "not_started" });
    expect(await as(circle, "elena", { operation: "cancel", shiftId })).toEqual({ ok: true, id: shiftId });
    expect(await as(circle, "amara", { operation: "check_in", shiftId })).toEqual({ ok: false, reason: "wrong_state" });
  });
});

describe("what the boundary reads", () => {
  it("takes only the form's fields, and a day and times on the circle's own clock", async () => {
    const circle = await visitorWithCircle(db);
    const ana = circle.members.ana;
    const visit = { operation: "schedule", kind: "visit", memberId: ana, title: " Ana visits ", date: "2026-11-05", start: "09:00", end: "11:00" };
    for (const forged of [
      null,
      { operation: "nothing" },
      { ...visit, startsAt: "2026-11-05T09:00:00Z" },
      { ...visit, kind: "party" },
      { ...visit, id: "not-a-uuid" },
      { ...visit, date: "2026-02-30" },
      { ...visit, start: "9am" },
      { ...visit, title: "x".repeat(81) },
      { operation: "check_in", shiftId: "nope" },
      { operation: "check_in", shiftId: await todaysShift(circle), extra: 1 },
    ]) {
      expect(await as(circle, "elena", forged), JSON.stringify(forged)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await as(circle, "elena", { ...visit, end: "08:00" })).toEqual({ ok: false, reason: "bad_times" });
    expect(await as(circle, "elena", { ...visit, date: "2030-01-01" })).toEqual({ ok: false, reason: "bad_date" });
    expect(await as(circle, "elena", { ...visit, memberId: "7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f" })).toEqual({ ok: false, reason: "bad_member" });
    // An aide shift is for a caregiver who has a rate.
    expect(await as(circle, "elena", { ...visit, kind: "aide" })).toEqual({ ok: false, reason: "bad_member" });

    const made = await as(circle, "elena", visit);
    expect(made).toMatchObject({ ok: true });
    // 09:00 in New York on 5 November is 14:00 UTC, and the title is kept trimmed.
    expect(await serviceRows(db, circle.circleId, "select title, starts_at::text as s, ends_at::text as e from shifts where member_id = $1 and title = 'Ana visits'", [ana])).toEqual([{ title: "Ana visits", s: "2026-11-05 14:00:00+00", e: "2026-11-05 16:00:00+00" }]);
  });

  it("schedules once however many times the same request arrives", async () => {
    const circle = await visitorWithCircle(db);
    const input = { operation: "schedule", id: "3b5f0f0e-6c2f-4d1e-9a52-0f6a1c1d2e3f", kind: "drive", memberId: circle.members.ana, date: "2026-11-06", start: "10:00", end: "11:00" };
    expect(await as(circle, "elena", input)).toEqual({ ok: true, id: input.id });
    expect(await as(circle, "elena", input)).toEqual({ ok: true, id: input.id });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from shifts where id = $1", [input.id])).toEqual([{ n: 1 }]);
  });
});

describe("the caregiver's pay rules and where their pay goes", () => {
  it("lets the organizer set the rules, in whole numbers, and nobody else", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const payeeId = seen.shiftRules[0]?.payeeId;
    const rules = { operation: "rules", payeeId, minimumMinutes: 45, overtimeAfterHours: 6, overtimePercent: 175 };
    expect(await as(circle, "marcus", rules)).toEqual({ ok: false, reason: "refused" });
    for (const forged of [{ ...rules, minimumMinutes: 1.5 }, { ...rules, overtimePercent: 400 }, { ...rules, overtimeAfterHours: 0 }, { ...rules, minimumMinutes: "45" }, { ...rules, payeeId: "7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f" }, { ...rules, extra: true }]) {
      expect((await as(circle, "elena", forged)).ok, JSON.stringify(forged)).toBe(false);
    }
    expect(await as(circle, "elena", rules)).toEqual({ ok: true, id: payeeId });
    expect((await snapshot(circle, circle.userId)).shiftRules[0]).toMatchObject({ minimumMinutes: 45, overtimeAfterMinutes: 360, overtimePercent: 175 });
  });

  it("lets only the caregiver say where their own pay goes, and shows only a masked address", async () => {
    const circle = await visitorWithCircle(db);
    expect(await as(circle, "elena", { operation: "target", wallet: "venmo", receiver: "@elena-e" })).toEqual({ ok: false, reason: "refused" });
    for (const [wallet, receiver] of [["venmo", "not an address"], ["paypal", "@amara-demo"], ["paypal", "+15551234567"], ["bank", "amara@example.com"], ["venmo", ""]]) {
      expect(await as(circle, "amara", { operation: "target", wallet, receiver }), `${wallet} ${receiver}`).toEqual({ ok: false, reason: "invalid_target" });
    }
    expect(await as(circle, "amara", { operation: "target", wallet: "venmo", receiver: "Amara.N@Example.com" })).toMatchObject({ ok: true });
    const mine = await snapshot(circle, await seatPerson(db, circle.circleId, circle.members.amara));
    expect(mine.shiftRules[0]).toMatchObject({ payoutWallet: "venmo" });
    expect(mine.payees.find((payee) => payee.receiver !== null)?.receiver).toBe("a••••@example.com");
    expect(JSON.stringify(mine)).not.toContain("amara.n@example.com");
  });
});

describe("the standing permission for shifts", () => {
  it("reads the terms back without storing anything, then records them once the yes is given, simulated in the demo", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const count = () => serviceRows(db, circle.circleId, "select count(*)::int as n from shift_permissions where circle_id = $1", [circle.circleId]);
    const before = await count();

    const review = await as(circle, "elena", { operation: "review_permission", draft: permissionDraft(seen, { perShift: "200,00", maxHours: "6" }) });
    expect(review).toMatchObject({ ok: true, terms: { maxMinutesPerDay: 360, perShiftCents: 20000, validFrom: "2026-10-30" } });
    // Rose decides above $50.00, so a $200.00 cap says so, and a $40.00 cap says nothing of it.
    expect(review).toMatchObject({ aboveUsualCents: expect.any(Number) });
    expect(await as(circle, "elena", { operation: "review_permission", draft: permissionDraft(seen, { perShift: "40.00" }) })).toMatchObject({ aboveUsualCents: 0 });
    expect(await count()).toEqual(before);

    expect(await as(circle, "elena", { operation: "grant_permission", draft: permissionDraft(seen), spokenText: "Four hours a day." })).toMatchObject({ ok: true });
    expect((await snapshot(circle, circle.userId)).shiftPermissions).toHaveLength(2);
    expect((await snapshot(circle, circle.userId)).shiftPermissions.at(-1)).toMatchObject({ perShiftCents: 15000, maxMinutesPerDay: 240, simulated: true, spokenText: "Four hours a day.", status: "active" });
  });

  it("takes only the form's fields, a caregiver of this circle, whole hours and plain amounts", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const grant = (draft: unknown, more: Record<string, unknown> = {}) => as(circle, "elena", { operation: "grant_permission", draft, ...more });
    for (const forged of [
      null,
      permissionDraft(seen, { status: "active" }),
      permissionDraft(seen, { maxHours: "four" }),
      permissionDraft(seen, { maxHours: "2.5" }),
      permissionDraft(seen, { validFrom: "tomorrow" }),
      permissionDraft(seen, { maxMinutesPerDay: 240 }),
    ]) {
      expect(await grant(forged), JSON.stringify(forged)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await grant(permissionDraft(seen, { payeeId: "7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f" }))).toEqual({ ok: false, reason: "bad_payee" });
    expect(await grant(permissionDraft(seen, { perShift: "a lot" }))).toEqual({ ok: false, reason: "amount" });
    expect(await grant(permissionDraft(seen, { perShift: "99999.00" }))).toEqual({ ok: false, reason: "above_ceiling" });
    expect(await grant(permissionDraft(seen, { maxHours: "25" }))).toEqual({ ok: false, reason: "bad_minutes" });
    expect(await grant(permissionDraft(seen, { expiresOn: "2026-10-30" }))).toEqual({ ok: false, reason: "bad_dates" });
    expect(await grant(permissionDraft(seen, { expiresOn: "2029-01-01" }))).toEqual({ ok: false, reason: "too_long" });
    expect(await grant(permissionDraft(seen), { spokenText: "x".repeat(401) })).toEqual({ ok: false, reason: "invalid" });
    expect(await grant(permissionDraft(seen), { spokenText: 5 })).toEqual({ ok: false, reason: "invalid" });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from shift_permissions where circle_id = $1", [circle.circleId])).toEqual([{ n: 1 }]);
  });

  it("may be paused by a contributor, resumed and ended only by whoever may grant it", async () => {
    const circle = await visitorWithCircle(db);
    const permissionId = String((await serviceRows(db, circle.circleId, "select id from shift_permissions where circle_id = $1", [circle.circleId]))[0]?.id);
    expect(await as(circle, "marcus", { operation: "pause_permission", permissionId })).toEqual({ ok: true, id: permissionId });
    expect(await as(circle, "marcus", { operation: "resume_permission", permissionId })).toEqual({ ok: false, reason: "refused" });
    expect(await as(circle, "daniel", { operation: "pause_permission", permissionId })).toEqual({ ok: false, reason: "refused" });
    expect(await as(circle, "elena", { operation: "resume_permission", permissionId })).toEqual({ ok: true, id: permissionId });
    expect(await as(circle, "elena", { operation: "revoke_permission", permissionId })).toEqual({ ok: true, id: permissionId });
    // An ended permission cannot be brought back: the database's diagram has no such move.
    expect((await as(circle, "elena", { operation: "resume_permission", permissionId })).ok).toBe(false);
    expect(await as(circle, "elena", { operation: "pause_permission", permissionId: "nope" })).toEqual({ ok: false, reason: "invalid" });
  });
});
