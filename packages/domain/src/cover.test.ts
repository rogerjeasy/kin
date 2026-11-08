import { describe, expect, it } from "vitest";

import { COVER_BUFFER_MINUTES, coverCandidates, coverIsTaken, coverKindOf, shiftNeedsCover, type CoverMember, type CoverRequest, type CoverShift } from "./cover.ts";
import { forAll } from "./testing/index.ts";

const TZ = "America/New_York";
// Thursday 12 November 2026, 1 pm to 5 pm New York (UTC-5).
const at = (day: string, time: string): Date => new Date(`${day}T${time}:00-05:00`);
const window = { startsAt: at("2026-11-12", "13:00"), endsAt: at("2026-11-12", "17:00") };

const sibling = (memberId: string, role: CoverMember["role"] = "contributor"): CoverMember => ({ memberId, role, active: true, hasRate: false });
const aide = (memberId: string): CoverMember => ({ memberId, role: "caregiver", active: true, hasRate: true });
const shift = (memberId: string, day: string, from: string, to: string, extra: Partial<CoverShift> = {}): CoverShift => ({
  memberId,
  kind: "visit",
  state: "scheduled",
  startsAt: at(day, from),
  endsAt: at(day, to),
  ...extra,
});
const request = (members: CoverMember[], shifts: CoverShift[] = [], extra: Partial<CoverRequest> = {}): CoverRequest => ({ window, cancelledBy: "amara", members, shifts, timezone: TZ, ...extra });
const ids = (result: ReturnType<typeof coverCandidates>) => result.map((each) => each.memberId);

describe("who may cover", () => {
  it("offers a sibling a visit and a rated caregiver an aide shift, and nobody else", () => {
    const members: CoverMember[] = [
      sibling("ana"),
      sibling("organizer-1", "organizer"),
      aide("bea"),
      { memberId: "no-rate", role: "caregiver", active: true, hasRate: false },
      sibling("rose", "parent"),
      sibling("daniel", "observer"),
      { memberId: "gone", role: "contributor", active: false, hasRate: false },
    ];
    expect(coverCandidates(request(members)).map(({ memberId, kind }) => [memberId, kind])).toEqual([
      ["ana", "visit"],
      ["bea", "aide"],
      ["organizer-1", "visit"],
    ]);
  });

  it("never offers the shift back to the person who called it off", () => {
    expect(ids(coverCandidates(request([aide("amara"), aide("bea")])))).toEqual(["bea"]);
  });

  it("knows each role's kind", () => {
    expect(coverKindOf({ role: "organizer", active: true, hasRate: false })).toBe("visit");
    expect(coverKindOf({ role: "caregiver", active: true, hasRate: false })).toBeNull();
    expect(coverKindOf({ role: "caregiver", active: false, hasRate: true })).toBeNull();
  });
});

describe("who is free", () => {
  it("leaves out anyone with a shift that overlaps the window, in any live state", () => {
    const states = ["scheduled", "checked_in", "checked_out", "confirmed", "priced", "paid", "credited"] as const;
    for (const state of states) {
      const busy = shift("ana", "2026-11-12", "15:00", "16:00", { state });
      expect(ids(coverCandidates(request([sibling("ana"), sibling("ben")], [busy])))).toEqual(["ben"]);
    }
  });

  it("does not count a shift that was called off", () => {
    const called = shift("ana", "2026-11-12", "15:00", "16:00", { state: "cancelled" });
    expect(ids(coverCandidates(request([sibling("ana")], [called])))).toEqual(["ana"]);
  });

  it("keeps thirty minutes between shifts, and not a minute less", () => {
    const before = (end: string) => shift("ana", "2026-11-12", "11:00", end);
    expect(COVER_BUFFER_MINUTES).toBe(30);
    expect(ids(coverCandidates(request([sibling("ana")], [before("12:31")])))).toEqual([]);
    expect(ids(coverCandidates(request([sibling("ana")], [before("12:30")])))).toEqual(["ana"]);
    const after = (start: string) => shift("ana", "2026-11-12", start, "19:00");
    expect(ids(coverCandidates(request([sibling("ana")], [after("17:29")])))).toEqual([]);
    expect(ids(coverCandidates(request([sibling("ana")], [after("17:30")])))).toEqual(["ana"]);
  });

  it("takes the buffer as an argument", () => {
    const near = shift("ana", "2026-11-12", "17:10", "18:00");
    expect(ids(coverCandidates(request([sibling("ana")], [near])))).toEqual([]);
    expect(ids(coverCandidates(request([sibling("ana")], [near], { bufferMinutes: 0 })))).toEqual(["ana"]);
  });

  it("is not blocked by someone else's shift", () => {
    expect(ids(coverCandidates(request([sibling("ana")], [shift("ben", "2026-11-12", "13:00", "17:00")])))).toEqual(["ana"]);
  });
});

describe("the order", () => {
  it("puts the person with the fewest hours that day first, then the fewest that week", () => {
    const shifts = [
      shift("ana", "2026-11-12", "08:00", "10:00"), // 2 h on the day
      shift("ben", "2026-11-12", "08:00", "09:00"), // 1 h on the day, 1 h this week
      shift("cleo", "2026-11-09", "08:00", "12:00"), // 4 h earlier in the week, none that day
      shift("dan", "2026-11-10", "08:00", "09:00"), // 1 h earlier in the week, none that day
    ];
    const result = coverCandidates(request([sibling("ana"), sibling("ben"), sibling("cleo"), sibling("dan"), sibling("eve")], shifts));
    expect(result.map(({ memberId, minutesThatDay, minutesThisWeek }) => [memberId, minutesThatDay, minutesThisWeek])).toEqual([
      ["eve", 0, 0],
      ["dan", 0, 60],
      ["cleo", 0, 240],
      ["ben", 60, 60],
      ["ana", 120, 120],
    ]);
  });

  it("counts a week from Monday to Sunday on the circle's calendar, not the one before or after", () => {
    const shifts = [
      shift("ana", "2026-11-08", "08:00", "10:00"), // the Sunday before
      shift("ana", "2026-11-16", "08:00", "10:00"), // the Monday after
      shift("ben", "2026-11-09", "08:00", "10:00"), // this Monday
    ];
    const result = coverCandidates(request([sibling("ana"), sibling("ben")], shifts));
    expect(result.map(({ memberId, minutesThisWeek }) => [memberId, minutesThisWeek])).toEqual([["ana", 0], ["ben", 120]]);
  });

  it("puts a shift on the day it began on the circle's clock, even where that is another UTC day", () => {
    // 9 pm New York on Thursday is already Friday in UTC.
    const lateThursday = { ...shift("ana", "2026-11-12", "21:00", "23:00") };
    expect(coverCandidates(request([sibling("ana")], [lateThursday]))[0]?.minutesThatDay).toBe(120);
  });

  it("breaks a full tie by member ID, whatever order the people came in", () => {
    const members = [sibling("c"), sibling("a"), sibling("b")];
    expect(ids(coverCandidates(request(members)))).toEqual(["a", "b", "c"]);
    expect(ids(coverCandidates(request(members.toReversed())))).toEqual(["a", "b", "c"]);
  });

  it("lists a member once, even when listed twice", () => {
    expect(ids(coverCandidates(request([sibling("ana"), sibling("ana")])))).toEqual(["ana"]);
  });
});

describe("what must hold for any input", () => {
  const people = ["a", "b", "c", "d", "e", "f"] as const;

  it("returns only free people, in a stable order, the same for any order of the input", () => {
    forAll(
      (random) => ({
        members: random.shuffle(people.map((id, index) => (index % 3 === 0 ? aide(id) : sibling(id, random.pick(["organizer", "contributor", "observer", "parent"] as const))))),
        shifts: Array.from({ length: random.int(0, 12) }, () => {
          const start = random.int(6, 21);
          return shift(random.pick(people), `2026-11-${String(random.int(9, 15)).padStart(2, "0")}`, `${String(start).padStart(2, "0")}:00`, `${String(Math.min(start + random.int(1, 3), 23)).padStart(2, "0")}:00`, {
            state: random.pick(["scheduled", "confirmed", "cancelled", "paid"] as const),
          });
        }),
      }),
      ({ members, shifts }) => {
        const result = coverCandidates(request(members, shifts));
        const again = coverCandidates(request(members.toReversed(), shifts.toReversed()));
        expect(result).toEqual(again);
        expect(new Set(ids(result)).size).toBe(result.length);
        for (const candidate of result) {
          expect(candidate.memberId).not.toBe("amara");
          const crowding = shifts.some(
            (each) => each.memberId === candidate.memberId && each.state !== "cancelled" && each.startsAt.getTime() < window.endsAt.getTime() + 30 * 60_000 && each.endsAt.getTime() > window.startsAt.getTime() - 30 * 60_000,
          );
          expect(crowding).toBe(false);
          expect(candidate.minutesThatDay).toBeLessThanOrEqual(candidate.minutesThisWeek);
        }
        const key = (each: (typeof result)[number]) => `${String(each.minutesThatDay).padStart(6, "0")}/${String(each.minutesThisWeek).padStart(6, "0")}/${each.memberId}`;
        expect(result.map(key)).toEqual(result.map(key).toSorted());
      },
    );
  });
});

describe("which shift needs cover", () => {
  const now = at("2026-11-10", "09:00");
  it("is an aide's cancelled shift still to come, and nothing else", () => {
    const base = { kind: "aide", state: "cancelled", startsAt: at("2026-11-12", "13:00") } as const;
    expect(shiftNeedsCover(base, now)).toBe(true);
    expect(shiftNeedsCover({ ...base, startsAt: at("2026-11-09", "13:00") }, now)).toBe(false);
    expect(shiftNeedsCover({ ...base, state: "scheduled" }, now)).toBe(false);
    expect(shiftNeedsCover({ ...base, kind: "visit" }, now)).toBe(false);
    expect(shiftNeedsCover({ ...base, startsAt: now }, now)).toBe(false);
  });
});

describe("whether the cancelled shift has already been covered", () => {
  it("is when a live aide or visit shift sits on exactly the same window, and not otherwise", () => {
    expect(coverIsTaken(window, [shift("ana", "2026-11-12", "13:00", "17:00")])).toBe(true);
    expect(coverIsTaken(window, [shift("bea", "2026-11-12", "13:00", "17:00", { kind: "aide", state: "confirmed" })])).toBe(true);
    expect(coverIsTaken(window, [shift("ana", "2026-11-12", "13:00", "17:00", { state: "cancelled" })])).toBe(false);
    expect(coverIsTaken(window, [shift("ana", "2026-11-12", "13:00", "16:00")])).toBe(false);
    expect(coverIsTaken(window, [shift("ana", "2026-11-12", "13:00", "17:00", { kind: "drive" })])).toBe(false);
    expect(coverIsTaken(window, [])).toBe(false);
  });
});
