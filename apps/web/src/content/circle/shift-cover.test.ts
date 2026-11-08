import { seatPerson, snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { MAX_COVER_PEOPLE, coverNeeds } from "./shift-cover";

const db = testDatabases();
let circle: VisitorCircle;
const seen = (persona: keyof VisitorCircle["members"]) => (persona === "elena" ? snapshotFor(db, circle.userId, circle.circleId) : seatPerson(db, circle.circleId, circle.members[persona]).then((userId) => snapshotFor(db, userId, circle.circleId)));

beforeAll(async () => {
  circle = await visitorWithCircle(db);
});

/** The demo circle's own clock on the day before its day care shift: the snapshot reads the real one, which is long after. */
const DEMO_EVE = new Date("2026-10-29T12:00:00Z");

/** The demo's day care shift for Amara, called off, with the rest of the calendar as it is. */
function withDayCareCalledOff(snapshot: CircleSnapshot, change: (shift: CircleSnapshot["shifts"][number]) => CircleSnapshot["shifts"][number] = (shift) => shift): CircleSnapshot {
  return { ...snapshot, circle: { ...snapshot.circle, now: DEMO_EVE }, shifts: snapshot.shifts.map((shift) => (shift.title === "Day care" ? change({ ...shift, state: "cancelled" as const, waitingFor: null }) : shift)) };
}

describe("the cancelled aide shifts that need cover", () => {
  it("offers nothing while no aide shift has been called off", async () => {
    expect(coverNeeds(await seen("elena"))).toEqual([]);
  });

  it("offers the organizer the people who are free, in the order plain code ranks them, and never the aide who called off", async () => {
    const snapshot = withDayCareCalledOff(await seen("elena"));
    const [need] = coverNeeds(snapshot);
    expect(coverNeeds(snapshot)).toHaveLength(1);
    expect(need?.shift.title).toBe("Day care");
    const names = (need?.candidates ?? []).map((candidate) => snapshot.members.find((member) => member.id === candidate.memberId)?.displayName);
    expect(names).not.toContain("Amara");
    expect(names).not.toContain("Rose");
    expect(names).not.toContain("Daniel");
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(MAX_COVER_PEOPLE);
    // Every one of them is family here, so each would count as a care visit; nobody is offered money.
    expect((need?.candidates ?? []).every((candidate) => candidate.kind === "visit")).toBe(true);
    const ordered = (need?.candidates ?? []).map((candidate) => [candidate.minutesThatDay, candidate.minutesThisWeek]);
    expect(ordered).toEqual(ordered.toSorted((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0)));
  });

  it("gives the window as the day and clock times the scheduling operation takes, on the circle's calendar", async () => {
    const snapshot = withDayCareCalledOff(await seen("elena"));
    const [need] = coverNeeds(snapshot);
    expect(need?.window).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), start: expect.stringMatching(/^\d{2}:\d{2}$/), end: expect.stringMatching(/^\d{2}:\d{2}$/) });
    const { shift } = need ?? { shift: null };
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: snapshot.circle.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    expect(need?.window?.start).toBe(clock.format(shift?.startsAt));
    expect(need?.window?.end).toBe(clock.format(shift?.endsAt));
  });

  it("gives no window to a shift that runs past midnight", async () => {
    const [night] = coverNeeds(withDayCareCalledOff(await seen("elena"), (shift) => ({ ...shift, endsAt: new Date(shift.startsAt.getTime() + 20 * 3_600_000) })));
    expect(night?.window).toBeNull();
  });

  it("offers the parent the same, who may schedule too, and nothing to a caregiver, a contributor who may not, or an observer", async () => {
    const roles = { rose: true, amara: false, daniel: false } as const;
    for (const [persona, offered] of Object.entries(roles) as [keyof typeof roles, boolean][]) {
      const snapshot = withDayCareCalledOff(await seen(persona));
      expect(coverNeeds(snapshot).length > 0, persona).toBe(offered);
    }
  });

  it("is not offered for a shift that has begun or passed, a visit that was called off, or a window someone already covers", async () => {
    const base = { ...(await seen("elena")), circle: { ...(await seen("elena")).circle, now: DEMO_EVE } };
    const past = withDayCareCalledOff(base, (shift) => ({ ...shift, startsAt: new Date(base.circle.now.getTime() - 3_600_000), endsAt: new Date(base.circle.now.getTime() + 3_600_000) }));
    expect(coverNeeds(past)).toEqual([]);
    const aVisit = withDayCareCalledOff(base, (shift) => ({ ...shift, kind: "visit" as const }));
    expect(coverNeeds(aVisit)).toEqual([]);
    const called = withDayCareCalledOff(base);
    const [need] = coverNeeds(called);
    const taken = { ...called, shifts: [...called.shifts, { ...(need?.shift as CircleSnapshot["shifts"][number]), id: "cover-1", kind: "visit" as const, state: "scheduled" as const }] };
    expect(coverNeeds(taken)).toEqual([]);
  });

  it("leaves out anyone who already has a shift at that time", async () => {
    const base = await seen("elena");
    const called = withDayCareCalledOff(base);
    const [need] = coverNeeds(called);
    const first = need?.candidates[0];
    if (first === undefined || need === undefined) throw new Error("the demo circle has someone free");
    const busy = { ...need.shift, startsAt: new Date(need.shift.startsAt.getTime() + 30 * 60_000), id: "busy-1", memberId: first.memberId, kind: "visit" as const, state: "scheduled" as const };
    const [after] = coverNeeds({ ...called, shifts: [...called.shifts, busy] });
    expect(after?.candidates.map((candidate) => candidate.memberId)).not.toContain(first.memberId);
  });
});
