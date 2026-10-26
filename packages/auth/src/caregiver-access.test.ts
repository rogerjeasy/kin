import { describe, expect, it } from "vitest";
import { caregiverAccess } from "./caregiver-access.ts";

describe("caregiver billing has independent account and circle checks", () => {
  it("refuses observers, missing groups and mismatched roles", () => {
    expect(caregiverAccess({ role: "observer", status: "active" }, "caregiver_bill.submit", ["caregiver"])).toBe(false);
    expect(caregiverAccess({ role: "caregiver", status: "active" }, "caregiver_bill.submit", [])).toBe(false);
    expect(caregiverAccess({ role: "caregiver", status: "active" }, "caregiver_bill.submit", ["family_member"])).toBe(false);
    expect(caregiverAccess({ role: "organizer", status: "active" }, "caregiver_rate.manage", ["caregiver"])).toBe(false);
    expect(caregiverAccess(null, "caregiver_bill.submit", "demo")).toBe(false);
  });
  it("allows the matching group and circle role, including verified demo seats", () => {
    expect(caregiverAccess({ role: "caregiver", status: "active" }, "caregiver_bill.submit", ["caregiver"])).toBe(true);
    expect(caregiverAccess({ role: "organizer", status: "active" }, "caregiver_rate.manage", ["family_member"])).toBe(true);
    expect(caregiverAccess({ role: "caregiver", status: "active" }, "caregiver_bill.submit", "demo")).toBe(true);
    expect(caregiverAccess({ role: "caregiver", status: "left" }, "caregiver_bill.submit", "demo")).toBe(false);
  });
  it("lets only organizers and contributors from family accounts review a caregiver's bill", () => {
    for (const role of ["caregiver", "observer", "parent"] as const) {
      expect(caregiverAccess({ role, status: "active" }, "caregiver_bill.review", "demo")).toBe(false);
      expect(caregiverAccess({ role, status: "active" }, "caregiver_bill.review", ["family_member", "administrator"])).toBe(false);
    }
    for (const role of ["organizer", "contributor"] as const) {
      expect(caregiverAccess({ role, status: "active" }, "caregiver_bill.review", ["family_member"])).toBe(true);
      expect(caregiverAccess({ role, status: "active" }, "caregiver_bill.review", "demo")).toBe(true);
      expect(caregiverAccess({ role, status: "active" }, "caregiver_bill.review", ["caregiver"])).toBe(false);
      expect(caregiverAccess({ role, status: "left" }, "caregiver_bill.review", ["family_member"])).toBe(false);
    }
  });
});
