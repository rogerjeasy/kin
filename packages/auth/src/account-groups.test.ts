import { describe, expect, it } from "vitest";

import { GRANTABLE_ACCOUNT_TYPES, accountTypesOwed } from "./account-groups.ts";

describe("the account types Kin grants", () => {
  it("gives every person the default type, once", () => {
    expect(accountTypesOwed([], [])).toEqual(["family_member"]);
    expect(accountTypesOwed(["family_member"], [])).toEqual([]);
  });

  it("gives caregiver only for a caregiver's seat in a real circle", () => {
    expect(accountTypesOwed(["family_member"], [{ role: "caregiver", demo: false }])).toEqual(["caregiver"]);
    expect(accountTypesOwed(["family_member"], [{ role: "caregiver", demo: true }])).toEqual([]);
    for (const role of ["organizer", "contributor", "parent", "observer"] as const) {
      expect(accountTypesOwed(["family_member"], [{ role, demo: false }])).toEqual([]);
    }
    expect(accountTypesOwed(["family_member", "caregiver"], [{ role: "caregiver", demo: false }])).toEqual([]);
  });

  it("never grants a professional or an administrator, whatever the seats", () => {
    expect(GRANTABLE_ACCOUNT_TYPES).toEqual(["family_member", "caregiver"]);
    const seats = (["organizer", "contributor", "parent", "caregiver", "observer"] as const).map((role) => ({ role, demo: false }));
    expect(accountTypesOwed([], seats)).toEqual(["family_member", "caregiver"]);
  });
});
