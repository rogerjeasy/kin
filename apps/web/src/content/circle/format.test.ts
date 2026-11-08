import type { CircleSnapshot } from "@kin/db";
import { describe, expect, it } from "vitest";

import { circleFormatters } from "./format";

// Only the two fields the formatters read.
const circle = { circle: { currency: "USD", timezone: "America/New_York" } } as unknown as CircleSnapshot;

describe("the dashboard's formatters", () => {
  it("write instants in the circle's time zone, so the clock agrees with the days the record keeps", () => {
    const format = circleFormatters("en", circle);

    expect(format.longDay(new Date("2026-11-08T02:00:00Z"))).toBe("Saturday, November 7, 2026");
    expect(format.dateTime(new Date("2026-11-07T02:23:00Z"))).toBe("Nov 6, 9:23 PM");
  });
});
