import { describe, expect, it } from "vitest";

import { sectionsForRole } from "./dashboard-context";

describe("the sections each role opens, in their order", () => {
  it("puts Listen first for the parent, so her first screen is what Kin tells her", () => {
    expect(sectionsForRole("parent")[0]).toBe("listen");
    expect(sectionsForRole("parent")).toContain("overview");
  });

  it("keeps the family's overview first for everyone else who sees the money", () => {
    for (const role of ["organizer", "contributor", "observer"] as const) {
      expect(sectionsForRole(role)[0], role).toBe("overview");
      expect(sectionsForRole(role), role).toContain("listen");
    }
  });

  it("never offers a caregiver Listen, since it speaks the circle's money", () => {
    expect(sectionsForRole("caregiver")).not.toContain("listen");
    expect(sectionsForRole("caregiver")).not.toContain("overview");
  });
});
