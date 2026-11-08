import type { CircleSnapshot } from "@kin/db";
import { describe, expect, it } from "vitest";

import { shiftWeek } from "./shift-week";

const circleAt = (now: string, timezone = "America/New_York") => ({ circle: { now: new Date(now), timezone } }) as unknown as CircleSnapshot;

describe("the week the shifts screen shows", () => {
  it("is the circle's own week by default, Monday to Sunday, on the circle's calendar", () => {
    // Friday 30 October 2026 in New York.
    expect(shiftWeek(circleAt("2026-10-30T18:00:00Z"), undefined)).toEqual({ start: "2026-10-26", end: "2026-11-01", previous: "2026-10-19", next: "2026-11-02", current: true });
    // 03:00 UTC on Monday is still Sunday evening in New York, which belongs to the week before.
    expect(shiftWeek(circleAt("2026-11-02T03:00:00Z"), undefined).start).toBe("2026-10-26");
  });

  it("reads any day of a week as that week, and knows when it is not the current one", () => {
    const week = shiftWeek(circleAt("2026-10-30T18:00:00Z"), "2026-11-04");
    expect(week).toMatchObject({ start: "2026-11-02", end: "2026-11-08", current: false });
  });

  it("ignores anything that is not a real day, or is years away", () => {
    for (const asked of ["", "tomorrow", "2026-02-30", "2026-13-01", "2026-10-30T00:00", "20261030", "2099-01-01", "1999-01-01"]) {
      expect(shiftWeek(circleAt("2026-10-30T18:00:00Z"), asked).start).toBe("2026-10-26");
    }
  });
});
