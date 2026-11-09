import { snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { formatters } from "@/lib/format";

import { circleNames } from "./names";
import { calendarData } from "./shift-calendar";
import { needItems, schedulePeople } from "./shift-needs";
import { mayGrantShiftPermission, permissionViews } from "./shift-permissions";
import { anythingMoving, latestPaid, needsOf, shiftViews } from "./shift-views";
import { shiftWeek } from "./shift-week";
import { seatPerson } from "@kin/db/testing";

const db = testDatabases();
let circle: VisitorCircle;
const seen = (persona: keyof VisitorCircle["members"]) => (persona === "elena" ? snapshotFor(db, circle.userId, circle.circleId) : seatPerson(db, circle.circleId, circle.members[persona]).then((userId) => snapshotFor(db, userId, circle.circleId)));

beforeAll(async () => {
  circle = await visitorWithCircle(db);
});

// snapshotFor reads on the real clock, so the week is asked for by day.
const WEEK = "2026-10-30";
const weekOf = (snapshot: CircleSnapshot) => shiftWeek(snapshot, WEEK);

describe("the calendar of the demo circle", () => {
  it("shows the week of the demo clock, with today's shift waiting to be tapped and the others on the calendar", async () => {
    const snapshot = await seen("elena");
    const views = shiftViews(snapshot, weekOf(snapshot));
    expect(views.map((view) => [view.shift.title, view.shift.kind, view.chip, view.tone])).toEqual([
      ["Day care", "aide", "scheduled", "neutral"],
      ["Ana visits Rose", "visit", "scheduled", "neutral"],
    ]);
    // No shift was paid before the demo begins: every payment is in the ledger, and the seeded month holds none for a shift.
    expect(shiftViews(snapshot, shiftWeek(snapshot, "2026-10-21"))).toEqual([]);
    expect(snapshot.shifts.filter((shift) => shift.state === "paid" || shift.proposalId !== null)).toEqual([]);
  });

  it("gives a caregiver only their own shifts, and the tap that is theirs to make", async () => {
    const snapshot = await seen("amara");
    expect(shiftViews(snapshot, weekOf(snapshot)).map((view) => view.shift.title)).toEqual(["Day care"]);
    expect(needsOf(snapshot).map((need) => need.kind)).toEqual(["check_in"]);
    expect(shiftViews(snapshot, weekOf(snapshot))[0]?.canCancel).toBe(true);
    expect(snapshot.shiftPermissions).toEqual([]);
    // Nothing was paid yet, so there is no payment to tell her about (server/shifts.test.ts follows one in).
    expect(latestPaid(snapshot)).toBeNull();
  });

  it("tells nobody else that a payment came in for a shift of their own", async () => {
    for (const persona of ["elena", "rose", "ana"] as const) expect(latestPaid(await seen(persona)), persona).toBeNull();
  });

  it("asks nobody for anything until a visit has begun", async () => {
    for (const persona of ["elena", "rose", "marcus", "ana", "daniel"] as const) expect(needsOf(await seen(persona)), persona).toEqual([]);
    expect(anythingMoving(await seen("elena"))).toBe(false);
  });

  it("lets only the organizer and the parent call off someone else's shift, and an observer nothing", async () => {
    const cancellable = async (persona: keyof VisitorCircle["members"]) => shiftViews(await seen(persona), weekOf(await seen(persona))).map((view) => view.canCancel);
    expect(await cancellable("elena")).toEqual([true, true]);
    expect(await cancellable("rose")).toEqual([true, true]);
    // Ana may call off her own visit and nothing else; Marcus none; the observer none.
    expect(await cancellable("ana")).toEqual([false, true]);
    expect(await cancellable("marcus")).toEqual([false, false]);
    expect(await cancellable("daniel")).toEqual([false, false]);
  });

  it("offers the permission to grant to the organizer playing the parent in the demo, and to no one who may only watch", async () => {
    const [elena, marcus, daniel] = [await seen("elena"), await seen("marcus"), await seen("daniel")];
    expect([mayGrantShiftPermission(elena), mayGrantShiftPermission(marcus), mayGrantShiftPermission(daniel)]).toEqual([true, false, false]);
    expect(permissionViews(elena)).toMatchObject([{ canPause: true, canEnd: true, canResume: false, permission: { status: "active", perShiftCents: 15000, simulated: true } }]);
    expect(permissionViews(marcus)[0]).toMatchObject({ canPause: true, canEnd: false });
    expect(permissionViews(daniel)[0]).toMatchObject({ canPause: false, canEnd: false });
  });
});

describe("what the screens are given in words", () => {
  it("builds the calendar's rows and blocks, and the parent's question in her own language", async () => {
    const english = await getDictionary("en");
    const snapshot = await seen("elena");
    const format = formatters("en", "USD", snapshot.circle.timezone);
    const names = circleNames(snapshot, english);
    const views = shiftViews(snapshot, weekOf(snapshot));
    const data = calendarData(views, english.dashboard.shifts, names);
    expect(data.resources.map((person) => person.name).toSorted()).toEqual(["Amara", "Ana"]);
    expect(data.events.map((event) => [event.title, event.tone, event.statusText])).toEqual([["Day care", "neutral", "Planned"], ["Ana visits Rose", "neutral", "Planned"]]);

    // Once Amara has checked in, the family is asked in plain words.
    const checkedIn = { ...snapshot, shifts: snapshot.shifts.map((shift) => (shift.title === "Day care" ? { ...shift, state: "checked_in" as const, checkedInAt: new Date("2026-10-30T14:05:00Z"), waitingFor: "check_out" as const } : shift)) };
    const [need] = needItems(checkedIn, needsOf(checkedIn), english.dashboard.shifts, format, names);
    expect(need).toMatchObject({ kind: "word", headline: "Was Amara here this morning?", buttonLabel: "Yes, Amara was here this morning", toYou: false, wallet: "paypal" });
    expect(need?.hint).toBe("Amara checked in at 10:05 AM. Your yes is the family’s key, so say it only if you know the visit happened.");

    // Planned for the morning but begun in the afternoon: the question agrees with the check-in shown beside it.
    const late = { ...snapshot, shifts: snapshot.shifts.map((shift) => (shift.title === "Day care" ? { ...shift, state: "checked_in" as const, checkedInAt: new Date("2026-10-30T18:25:00Z"), waitingFor: "check_out" as const } : shift)) };
    const [lateNeed] = needItems(late, needsOf(late), english.dashboard.shifts, format, names);
    expect(lateNeed).toMatchObject({ headline: "Was Amara here this afternoon?", buttonLabel: "Yes, Amara was here this afternoon" });
    expect(lateNeed?.hint).toContain("checked in at 2:25 PM");
  });

  it("lists who can take each kind of shift: an aide shift only a caregiver with a rate, never an observer", async () => {
    const people = schedulePeople(await seen("elena"));
    expect(people.aide.map((person) => person.name)).toEqual(["Amara"]);
    expect(people.visit.map((person) => person.name).toSorted()).toEqual(["Amara", "Ana", "Elena", "Marcus", "Rose"]);
    expect(people.drive).toEqual(people.visit);
  });
});
