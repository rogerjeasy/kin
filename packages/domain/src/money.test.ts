import { describe, expect, it } from "vitest";

import { InvalidMoneyError, formatMoney } from "./money.ts";

describe("formatMoney", () => {
  it("formats integer cents as a currency amount", () => {
    expect(formatMoney({ cents: 8400, currency: "USD" }, "en")).toBe("$84.00");
  });

  it("keeps the cents exact for large amounts", () => {
    expect(
      formatMoney({ cents: 9007199254740991, currency: "USD" }, "en"),
    ).toBe("$90,071,992,547,409.91");
  });

  it("pads cents below ten", () => {
    expect(formatMoney({ cents: 5, currency: "USD" }, "en")).toBe("$0.05");
  });

  it("formats negative amounts", () => {
    expect(formatMoney({ cents: -12600, currency: "USD" }, "en")).toBe(
      "-$126.00",
    );
  });

  it("follows the locale's separators and symbol position", () => {
    expect(formatMoney({ cents: 26400, currency: "USD" }, "de")).toBe(
      "264,00 $",
    );
  });

  it("uses the currency's own number of minor units", () => {
    expect(formatMoney({ cents: 900, currency: "JPY" }, "en")).toBe("¥900");
  });

  it("refuses an amount that is not a whole number of minor units", () => {
    expect(() => formatMoney({ cents: 84.5, currency: "USD" }, "en")).toThrow(
      InvalidMoneyError,
    );
  });
});
