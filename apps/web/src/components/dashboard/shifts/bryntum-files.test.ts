import { describe, expect, it } from "vitest";

import { BRYNTUM_LOCALES, bryntumLocaleFile, bryntumModuleFile, bryntumUrl } from "./bryntum-files.ts";
import { localeFor } from "./care-calendar-locale.ts";

describe("the Bryntum files the browser loads", () => {
  it("name the version in every served file, so a file never changes under its name", () => {
    expect(bryntumModuleFile("7.3.8")).toEqual({ source: "scheduler.module.js", served: "scheduler-7.3.8.module.js" });
    expect(bryntumLocaleFile("7.3.8", "FrFr")).toEqual({ source: "locales/scheduler.locale.FrFr.js", served: "scheduler-7.3.8.locale.FrFr.js" });
  });

  it("are served from the vendor folder of the public directory", () => {
    expect(bryntumUrl(bryntumModuleFile("7.3.8"))).toBe("/vendor/bryntum/scheduler-7.3.8.module.js");
  });

  it("include a locale file for every language the calendar speaks", () => {
    for (const tag of ["en", "fr", "de", "es", "it", "ar", "he", "ja"]) expect(BRYNTUM_LOCALES).toContain(localeFor(tag).name);
  });
});
