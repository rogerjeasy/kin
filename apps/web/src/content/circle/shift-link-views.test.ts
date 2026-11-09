import { asPerson, checkInShift, checkOutShift, type CircleSnapshot } from "@kin/db";
import { seatPerson, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { formatters } from "@/lib/format";

import { circleNames } from "./names";
import { needItems } from "./shift-needs";
import { needsOf, shiftViews } from "./shift-views";
import { shiftWeek } from "./shift-week";

const db = testDatabases();
const WEEK = "2026-10-30";
const english = await getDictionary("en");
let circle: VisitorCircle;

const seen = async (persona: keyof VisitorCircle["members"]): Promise<CircleSnapshot> =>
  snapshotFor(db, persona === "elena" ? circle.userId : await seatPerson(db, circle.circleId, circle.members[persona]), circle.circleId);
const todays = (snapshot: CircleSnapshot) => shiftViews(snapshot, shiftWeek(snapshot, WEEK)).find((view) => view.shift.kind === "aide" && view.shift.state !== "cancelled");
const real = (snapshot: CircleSnapshot): CircleSnapshot => ({ ...snapshot, circle: { ...snapshot.circle, demo: false } });

beforeAll(async () => {
  circle = await visitorWithCircle(db);
});

describe("who is offered a check-in link", () => {
  it("offers it to Amara for her own shift and to those who run the calendar, and never to an observer", async () => {
    expect(todays(await seen("amara"))).toMatchObject({ canLink: true });
    for (const persona of ["elena", "marcus", "rose"] as const) expect(todays(await seen(persona)), persona).toMatchObject({ canLink: true });
    expect(todays(await seen("daniel"))).toMatchObject({ canLink: false });
  });

  it("offers one for a sibling's drive, which is credited when its keys turn, and none for an appointment, which waits for no tap", async () => {
    const snapshot = await seen("elena");
    const viewOf = (kind: "drive" | "appointment") => {
      const shift = snapshot.shifts.find((each) => each.kind === kind && each.state === "scheduled");
      if (shift === undefined) throw new Error(`The demo has no ${kind}`);
      return shiftViews(snapshot, shiftWeek(snapshot, shift.startsAt.toISOString().slice(0, 10))).find((view) => view.shift.id === shift.id);
    };
    expect(viewOf("drive")).toMatchObject({ canLink: true, shift: { waitingFor: "check_in" } });
    expect(viewOf("appointment")).toMatchObject({ canLink: false, shift: { waitingFor: null } });
  });

  it("offers none for a shift that is already paid, and none for a shift whose time has long gone", async () => {
    const snapshot = await seen("elena");
    // Today's shift as it reads once both keys have turned and it was paid.
    const today = todays(snapshot);
    if (today === undefined) throw new Error("The demo has no aide shift today");
    const paidAt = new Date("2026-10-30T18:00:00Z");
    const paidShift = { ...today.shift, state: "paid" as const, checkedInAt: paidAt, checkedOutAt: paidAt, familyConfirmedAt: paidAt, waitingFor: null };
    const paid = { ...snapshot, shifts: snapshot.shifts.map((shift) => (shift.id === today.shift.id ? paidShift : shift)) };
    expect(shiftViews(paid, shiftWeek(paid, WEEK)).find((view) => view.shift.id === today.shift.id)).toMatchObject({ canLink: false });
    const late = { ...snapshot, circle: { ...snapshot.circle, now: new Date("2026-11-30T00:00:00Z") } };
    expect(todays(late)).toMatchObject({ canLink: false });
  });
});

describe("who can hear Kin's call", () => {
  it("is offered in a demo circle only once the visit has ended, to those who give the family's word", async () => {
    expect(todays(await seen("rose"))).toMatchObject({ canHearCall: false });
    const shiftId = todays(await seen("amara"))?.shift.id ?? "";
    // Each seating gives the seat to a new visitor, and the one before loses it, so the person who taps is seated last.
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    await asPerson(db.app, amara, (tx) => checkInShift(tx, { circleId: circle.circleId, shiftId }));
    await asPerson(db.app, amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId, now: new Date("2026-10-30T18:00:00Z") }));

    expect(todays(await seen("rose"))).toMatchObject({ canHearCall: true });
    // The caregiver, an observer and a real circle each get the real call or none, never the simulator.
    expect(todays(await seen("amara"))).toMatchObject({ canHearCall: false });
    expect(todays(await seen("daniel"))).toMatchObject({ canHearCall: false });
    expect(todays(real(await seen("rose")))).toMatchObject({ canHearCall: false });

    const snapshot = await seen("rose");
    const names = circleNames(snapshot, english);
    const items = needItems(snapshot, needsOf(snapshot), english.dashboard.shifts, formatters("en", "USD", "America/New_York"), names);
    expect(items.map((item) => [item.kind, item.callSim])).toEqual([["word", true]]);
    const inReal = real(snapshot);
    expect(needItems(inReal, needsOf(inReal), english.dashboard.shifts, formatters("en", "USD", "America/New_York"), circleNames(inReal, english)).map((item) => item.callSim)).toEqual([false]);
  });
});
