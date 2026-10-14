import { describe, expect, it } from "vitest";

import { localizedPath, pagePath, routeLocale, switchLocale } from "./routing";

describe("routeLocale", () => {
  it("serves an unprefixed path as English", () => {
    expect(routeLocale("/pricing")).toEqual({
      kind: "rewrite",
      pathname: "/en/pricing",
    });
    expect(routeLocale("/")).toEqual({ kind: "rewrite", pathname: "/en" });
  });

  it("lets a path through when it names another locale", () => {
    expect(routeLocale("/fr/pricing")).toEqual({ kind: "pass" });
    expect(routeLocale("/ar")).toEqual({ kind: "pass" });
  });

  it("sends an explicit English prefix back to the short address", () => {
    expect(routeLocale("/en/pricing")).toEqual({
      kind: "redirect",
      pathname: "/pricing",
    });
    expect(routeLocale("/en")).toEqual({ kind: "redirect", pathname: "/" });
  });

  it("does not mistake a page that starts with a locale's letters for a locale", () => {
    expect(routeLocale("/england")).toEqual({
      kind: "rewrite",
      pathname: "/en/england",
    });
  });
});

describe("localizedPath", () => {
  it("leaves English paths unprefixed", () => {
    expect(localizedPath("en", "/pricing")).toBe("/pricing");
    expect(localizedPath("en", "/")).toBe("/");
  });

  it("prefixes every other locale", () => {
    expect(localizedPath("fr", "/pricing")).toBe("/fr/pricing");
    expect(localizedPath("he", "/")).toBe("/he");
  });
});

describe("switchLocale", () => {
  it("keeps the visitor on the same page in the new language", () => {
    expect(switchLocale("/pricing", "ar")).toBe("/ar/pricing");
    expect(switchLocale("/fr/how-it-works", "de")).toBe("/de/how-it-works");
  });

  it("returns to the short address when switching to English", () => {
    expect(switchLocale("/fr/pricing", "en")).toBe("/pricing");
    expect(switchLocale("/fr", "en")).toBe("/");
  });

  it("switches the homepage", () => {
    expect(switchLocale("/", "it")).toBe("/it");
  });
});

describe("pagePath", () => {
  it("names the page whatever language prefix the address carries", () => {
    expect(pagePath("/safety")).toBe("/safety");
    expect(pagePath("/en/safety")).toBe("/safety");
    expect(pagePath("/fr/safety")).toBe("/safety");
  });

  it("names the homepage", () => {
    expect(pagePath("/")).toBe("/");
    expect(pagePath("/he")).toBe("/");
  });
});
