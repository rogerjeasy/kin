import { describe, expect, it } from "vitest";

import {
  THEME_STORAGE_KEY,
  parseThemeChoice,
  resolveTheme,
  themeScript,
} from "./theme";

describe("parseThemeChoice", () => {
  it("accepts the three choices", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("system")).toBe("system");
  });

  it("falls back to the system setting for anything else", () => {
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("blue")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("honours an explicit choice over the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system setting when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("themeScript", () => {
  function run(stored: string | null, systemPrefersDark: boolean) {
    const attributes: Record<string, string> = {};
    const execute = new Function("document", "localStorage", "matchMedia", themeScript);
    execute(
      { documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) } },
      { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) },
      () => ({ matches: systemPrefersDark }),
    );
    return attributes;
  }

  it("applies the stored choice before the page paints", () => {
    expect(run("dark", false)).toEqual({ "data-theme": "dark" });
    expect(run("light", true)).toEqual({ "data-theme": "light" });
  });

  it("follows the system setting when nothing is stored", () => {
    expect(run(null, true)).toEqual({ "data-theme": "dark" });
    expect(run(null, false)).toEqual({ "data-theme": "light" });
  });

  it("falls back to the system setting when storage is blocked", () => {
    const attributes: Record<string, string> = {};
    const execute = new Function("document", "localStorage", "matchMedia", themeScript);
    execute(
      { documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) } },
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      () => ({ matches: true }),
    );
    expect(attributes).toEqual({ "data-theme": "dark" });
  });
});
