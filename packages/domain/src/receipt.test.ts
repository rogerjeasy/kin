import { describe, expect, it } from "vitest";

import { MAX_RECEIPT_CENTS, MAX_RECEIPT_DESCRIPTION, RECEIPT_CATEGORIES, ReceiptError, checkReceipt } from "./receipt.ts";

const TODAY = "2026-10-30";
const valid = { category: "pharmacy", cents: 4200, description: "  Elm Street Pharmacy  ", spentOn: "2026-10-28" };

const reason = (input: Parameters<typeof checkReceipt>[0]): string | null => {
  try {
    checkReceipt(input, TODAY);
    return null;
  } catch (error) {
    if (error instanceof ReceiptError) return error.reason;
    throw error;
  }
};

describe("checkReceipt", () => {
  it("reads a receipt as written, trimming the description", () => {
    expect(checkReceipt(valid, TODAY)).toEqual({ category: "pharmacy", cents: 4200, description: "Elm Street Pharmacy", spentOn: "2026-10-28" });
    expect(checkReceipt({ ...valid, spentOn: TODAY }, TODAY).spentOn).toBe(TODAY);
  });

  it("files only under the ledger's own categories", () => {
    for (const category of RECEIPT_CATEGORIES) expect(reason({ ...valid, category })).toBeNull();
    for (const category of ["Pharmacy", "caregiver", "", null, 7]) expect(reason({ ...valid, category })).toBe("category");
  });

  it("takes whole cents above zero and up to the limit, never a float or a string", () => {
    expect(reason({ ...valid, cents: MAX_RECEIPT_CENTS })).toBeNull();
    for (const cents of [0, -1, 41.99, MAX_RECEIPT_CENTS + 1, Number.NaN, Number.POSITIVE_INFINITY, "4200", null]) {
      expect(reason({ ...valid, cents })).toBe("amount");
    }
  });

  it("needs a description of sensible length", () => {
    expect(reason({ ...valid, description: "x".repeat(MAX_RECEIPT_DESCRIPTION) })).toBeNull();
    for (const description of ["", "   ", "x".repeat(MAX_RECEIPT_DESCRIPTION + 1), null, 12]) expect(reason({ ...valid, description })).toBe("description");
  });

  it("refuses a date that is not a real day, or lies in the circle's future", () => {
    for (const spentOn of ["2026-10-31", "2026-02-30", "2026-13-01", "30/10/2026", "2026-10-3", "", null]) expect(reason({ ...valid, spentOn })).toBe("date");
  });
});
