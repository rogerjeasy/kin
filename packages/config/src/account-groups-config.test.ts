import { describe, expect, it } from "vitest";

import { readAccountGroupsEnabled } from "./account-groups-config.ts";

describe("putting people in their account groups", () => {
  it("is on only when switched on in so many words", () => {
    expect(readAccountGroupsEnabled({ KIN_AUTH_ASSIGN_GROUPS: "on" })).toBe(true);
    for (const value of [undefined, "", "true", "yes", "ON"]) {
      expect(readAccountGroupsEnabled({ KIN_AUTH_ASSIGN_GROUPS: value })).toBe(false);
    }
  });
});
