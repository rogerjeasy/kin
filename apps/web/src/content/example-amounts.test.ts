import { describe, expect, it } from "vitest";

import { exampleAmounts } from "./example-amounts";

describe("exampleAmounts", () => {
  it("formats the example family's figures for display", () => {
    expect(exampleAmounts("en")).toEqual({
      limit: "$50.00",
      bill: "$84.00",
      gasBill: "$57.00",
      caregiverPay: "$264.00",
      refill: "$42.00",
      elena: "$126.00",
      ana: "$40.00",
    });
  });

  it("uses the reader's number format", () => {
    expect(exampleAmounts("de").bill).toBe("84,00 $");
  });

  it("keeps Western digits in Arabic", () => {
    expect(exampleAmounts("ar").bill).toMatch(/84[.,]00/);
  });
});
