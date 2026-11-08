import { describe, expect, it } from "vitest";

import { backoffSeconds, errorName, shiftIdOf } from "./shift-message.ts";

describe("what the shift loops share about a message", () => {
  it("reads the shift from a payload that holds one id, and from nothing else", () => {
    const id = "7c1d9e2a-3b4c-4d5e-8f6a-1b2c3d4e5f60";
    expect(shiftIdOf({ shiftId: id })).toBe(id);
    for (const bad of [null, undefined, "x", 7, [], {}, { shiftId: 7 }, { shiftId: "not-an-id" }, { shiftId: id.toUpperCase() }, { shiftId: `${id} ` }]) {
      expect(shiftIdOf(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("backs off from 30 seconds, doubling, to an hour, however many attempts", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(backoffSeconds)).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600]);
    expect(backoffSeconds(1_000)).toBe(3600);
  });

  it("names an error by its class and never by its message", () => {
    expect(errorName(new TypeError("secret detail"))).toBe("TypeError");
    expect(errorName("text")).toBe("unknown");
  });
});
