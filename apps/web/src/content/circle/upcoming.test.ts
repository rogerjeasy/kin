import { describe, expect, it } from "vitest";

import { upcomingMonth } from "./upcoming";

describe("the month an upcoming list is headed with", () => {
  it("is the month the rows are due in, even when it is the month already open", () => {
    // Demo clock is 8 November: its rows fall on 10, 11, 14 and 17 November, not in December.
    expect(upcomingMonth([{ due: "2026-11-10" }, { due: "2026-11-11" }, { due: "2026-11-14" }, { due: "2026-11-17" }])).toBe("2026-11");
  });

  it("names no month when the rows span more than one", () => {
    expect(upcomingMonth([{ due: "2026-11-28" }, { due: "2026-12-02" }])).toBeNull();
  });

  it("names no month when there are no rows", () => {
    expect(upcomingMonth([])).toBeNull();
  });
});
