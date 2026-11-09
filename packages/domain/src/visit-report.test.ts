import { describe, expect, it } from "vitest";

import { MAX_SHIFT_MINUTES, SHIFT_KINDS } from "./shift.ts";
import { forAll } from "./testing/property.ts";
import { VISIT_REPORT_SCHEMA, matchVisitReport, parseVisitReport, type ReportableShift } from "./visit-report.ts";

const valid = {
  externalId: "sunrise-2026-11-03-amara",
  caregiver: "Amara",
  kind: "aide",
  startsAt: "2026-11-03T14:00:00Z",
  endsAt: "2026-11-03T18:00:00Z",
  checkedInAt: "2026-11-03T14:02:00Z",
  checkedOutAt: "2026-11-03T18:00:30Z",
  note: "Helped with lunch and a walk.",
};

const at = (iso: string) => new Date(iso);
/** The valid report without some of its fields. */
const without = (...keys: string[]) => Object.fromEntries(Object.entries(valid).filter(([key]) => !keys.includes(key)));
const shift = (change: Partial<ReportableShift> = {}): ReportableShift => ({ id: "shift-1", memberId: "amara", kind: "aide", startsAt: at("2026-11-03T14:00:00Z"), endsAt: at("2026-11-03T18:00:00Z"), cancelled: false, ...change });

describe("a visit an agency reports", () => {
  it("is read with its verified minutes, from check-in to check-out", () => {
    const parsed = parseVisitReport(valid);
    expect(parsed).toEqual({
      ok: true,
      report: { externalId: valid.externalId, caregiver: "Amara", kind: "aide", startsAt: at(valid.startsAt), endsAt: at(valid.endsAt), checkedInAt: at(valid.checkedInAt), checkedOutAt: at(valid.checkedOutAt), note: valid.note, minutes: 238 },
    });
  });

  it("counts the planned minutes when the agency verified no check-in", () => {
    const planned = without("checkedInAt", "checkedOutAt", "note");
    expect(parseVisitReport(planned)).toMatchObject({ ok: true, report: { minutes: 240, checkedInAt: null, checkedOutAt: null, note: null } });
  });

  it("refuses a field the schema does not list, a missing one, or one of the wrong shape", () => {
    expect(parseVisitReport({ ...valid, paid: true })).toEqual({ ok: false, reason: "shape" });
    expect(parseVisitReport({ ...valid, amountCents: 8800 })).toEqual({ ok: false, reason: "shape" });
    for (const key of VISIT_REPORT_SCHEMA.required) {
      const missing = without(key);
      expect(parseVisitReport(missing)).toEqual({ ok: false, reason: "shape" });
    }
    for (const change of [{ kind: "nurse" }, { caregiver: "<script>" }, { caregiver: " Amara" }, { note: "line\nbreak" }, { startsAt: "tomorrow" }, { externalId: "has space" }, { caregiver: 7 }, { caregiver: "" }]) {
      expect(parseVisitReport({ ...valid, ...change })).toEqual({ ok: false, reason: "shape" });
    }
    for (const input of [null, [], "visit", 3]) expect(parseVisitReport(input)).toEqual({ ok: false, reason: "shape" });
  });

  it("refuses times that are not one visit of at most a day", () => {
    expect(parseVisitReport({ ...valid, endsAt: valid.startsAt })).toEqual({ ok: false, reason: "times" });
    expect(parseVisitReport({ ...valid, endsAt: "2026-11-05T14:00:00Z" })).toEqual({ ok: false, reason: "times" });
    expect(parseVisitReport({ ...valid, checkedOutAt: "2026-11-03T13:00:00Z" })).toEqual({ ok: false, reason: "times" });
    const outOnly = without("checkedInAt");
    expect(parseVisitReport(outOnly)).toEqual({ ok: false, reason: "times" });
    expect(parseVisitReport({ ...valid, startsAt: "2026-02-30T14:00:00Z" })).toEqual({ ok: false, reason: "times" });
  });

  it("publishes the kinds of a shift as the kinds a visit may be", () => {
    expect(VISIT_REPORT_SCHEMA.properties.kind.enum).toEqual(SHIFT_KINDS);
    expect(VISIT_REPORT_SCHEMA.additionalProperties).toBe(false);
  });

  it("has whole, positive minutes of at most a day whenever it is accepted", () => {
    forAll(
      (random) => {
        const start = Date.UTC(2026, 10, random.int(1, 28), random.int(0, 23), random.int(0, 59));
        const length = random.int(-30, MAX_SHIFT_MINUTES + 60);
        const inOffset = random.int(-20, 20);
        const worked = random.int(-10, MAX_SHIFT_MINUTES + 30);
        return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + length * 60_000).toISOString(), checkedInAt: new Date(start + inOffset * 60_000).toISOString(), checkedOutAt: new Date(start + (inOffset + worked) * 60_000 + random.int(0, 59) * 1000).toISOString() };
      },
      (times) => {
        const parsed = parseVisitReport({ ...valid, ...times });
        if (!parsed.ok) return;
        expect(Number.isSafeInteger(parsed.report.minutes)).toBe(true);
        expect(parsed.report.minutes).toBeGreaterThan(0);
        expect(parsed.report.minutes).toBeLessThanOrEqual(MAX_SHIFT_MINUTES);
      },
    );
  });
});

describe("the shift a report is about", () => {
  const report = { memberId: "amara", kind: "aide" as const, startsAt: at("2026-11-03T14:00:00Z"), endsAt: at("2026-11-03T18:00:00Z") };

  it("is the caregiver's own shift of the same kind that overlaps it most", () => {
    const shifts = [shift({ id: "short", startsAt: at("2026-11-03T17:00:00Z") }), shift({ id: "long" }), shift({ id: "other", memberId: "someone" }), shift({ id: "visit", kind: "visit" })];
    expect(matchVisitReport(report, shifts)).toBe("long");
  });

  it("is none for a cancelled shift, one that does not overlap, or a caregiver Kin did not recognise", () => {
    expect(matchVisitReport(report, [shift({ cancelled: true })])).toBeNull();
    expect(matchVisitReport(report, [shift({ startsAt: at("2026-11-03T18:00:00Z"), endsAt: at("2026-11-03T20:00:00Z") })])).toBeNull();
    expect(matchVisitReport({ ...report, memberId: null }, [shift()])).toBeNull();
  });

  it("is the earlier of two that overlap it equally", () => {
    expect(matchVisitReport(report, [shift({ id: "b", startsAt: at("2026-11-03T16:00:00Z"), endsAt: at("2026-11-03T20:00:00Z") }), shift({ id: "a", startsAt: at("2026-11-03T12:00:00Z"), endsAt: at("2026-11-03T16:00:00Z") })])).toBe("a");
  });
});
