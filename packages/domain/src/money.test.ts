import { describe, expect, it } from "vitest";

import { InvalidMoneyError, decimalAmount, formatMoney, sumCents } from "./money.ts";

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

describe("sumCents", () => {
  it("adds whole amounts", () => {
    expect(sumCents([8400, 5700, -4200])).toBe(9900);
    expect(sumCents([])).toBe(0);
  });

  it("refuses a fractional amount", () => {
    expect(() => sumCents([100, 0.5])).toThrow(InvalidMoneyError);
  });

  it("refuses a total too large to hold exactly", () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(
      InvalidMoneyError,
    );
  });
});

describe("an amount for a file", () => {
  it("is written exactly in the currency's minor digits, with no rounding", () => {
    expect(decimalAmount({ cents: 8400, currency: "USD" })).toBe("84.00");
    expect(decimalAmount({ cents: 5, currency: "USD" })).toBe("0.05");
    expect(decimalAmount({ cents: -1487, currency: "USD" })).toBe("-14.87");
    expect(decimalAmount({ cents: 9_007_199_254_740_991, currency: "USD" })).toBe("90071992547409.91");
    expect(decimalAmount({ cents: 500, currency: "JPY" })).toBe("500");
  });
});
