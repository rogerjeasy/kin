import { describe, expect, it } from "vitest";

import { typedAmount } from "./typed-amount.ts";

describe("typedAmount", () => {
  it("reads a decimal comma as a decimal point", () => {
    expect(typedAmount("50,00")).toBe("50.00");
    expect(typedAmount(" 42,5 ")).toBe("42.5");
  });

  it("leaves a dot, a whole number and an ambiguous grouping as typed", () => {
    expect(typedAmount("50.00")).toBe("50.00");
    expect(typedAmount("50")).toBe("50");
    expect(typedAmount("1,000")).toBe("1,000");
    expect(typedAmount("1,000.50")).toBe("1,000.50");
  });
});
