import { describe, expect, it } from "vitest";

import {
  defaultLocale,
  directionOf,
  isLocale,
  locales,
  numberLocaleOf,
} from "./locales";

describe("locales", () => {
  it("offers the seven launch languages with English first", () => {
    expect(locales).toEqual(["en", "fr", "de", "it", "es", "ar", "he"]);
    expect(defaultLocale).toBe("en");
  });

  it("recognises a supported locale and rejects anything else", () => {
    expect(isLocale("he")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale("toString")).toBe(false);
  });

  it("reads Arabic and Hebrew right to left, and the rest left to right", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("he")).toBe("rtl");
    expect(locales.filter((locale) => directionOf(locale) === "ltr")).toEqual([
      "en",
      "fr",
      "de",
      "it",
      "es",
    ]);
  });

  it("formats numbers with Western digits in every locale", () => {
    const formatted = new Intl.NumberFormat(numberLocaleOf("ar")).format(50);
    expect(formatted).toBe("50");
  });
});
