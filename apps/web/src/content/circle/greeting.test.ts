import { describe, expect, it } from "vitest";

import { partOfDay } from "./greeting";

describe("the greeting's part of the day, on the circle's clock", () => {
  it("is morning, afternoon or evening where the family lives, whatever the reader's zone", () => {
    // 11:57 UTC is 6:57 in New York: a European reader at noon still sees "Good morning".
    expect(partOfDay(new Date("2026-11-10T11:57:00Z"), "America/New_York")).toBe("morning");
    expect(partOfDay(new Date("2026-11-10T19:00:00Z"), "America/New_York")).toBe("afternoon");
    expect(partOfDay(new Date("2026-11-11T01:00:00Z"), "America/New_York")).toBe("evening");
  });

  it("treats the small hours as evening and four in the morning as morning", () => {
    expect(partOfDay(new Date("2026-11-10T03:59:00Z"), "UTC")).toBe("evening");
    expect(partOfDay(new Date("2026-11-10T04:00:00Z"), "UTC")).toBe("morning");
    expect(partOfDay(new Date("2026-11-10T12:00:00Z"), "UTC")).toBe("afternoon");
    expect(partOfDay(new Date("2026-11-10T18:00:00Z"), "UTC")).toBe("evening");
  });
});
