import { SHIFT_CALL_STATES } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { checkWords, plannedWords } from "@/components/check-link/check-result";
import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { slotsOf } from "@/i18n/template";

import { SHIFT_FAILURES } from "./shift-words";

const english = await getDictionary("en");

function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(texts) : [];
}

describe.each(locales)("the %s words for check-in links, door tags and Kin's call", (locale) => {
  it("use no em dash and no empty sentence, in the page a caregiver opens or in the screens of the family", async () => {
    const { checkLink, dashboard } = await getDictionary(locale);
    const all = texts([checkLink, dashboard.shiftLinks, dashboard.shiftCalls, dashboard.shiftDoor, dashboard.shifts.target.venmoRefused, dashboard.shifts.target.venmoSimulated]);
    expect(all.length).toBeGreaterThan(90);
    for (const text of all) {
      expect(text.trim(), text).not.toBe("");
      expect(text).not.toContain("—");
    }
  });

  it("fill each sentence from the record, with the slots the code supplies and no others", async () => {
    const { checkLink, dashboard } = await getDictionary(locale);
    const { shiftLinks, shiftCalls } = dashboard;
    expect(slotsOf(checkLink.results.checkedIn)).toEqual(["name", "time"]);
    expect(slotsOf(checkLink.results.checkedOut)).toEqual(["name", "time"]);
    expect(slotsOf(checkLink.results.alreadyIn)).toEqual(["time"]);
    expect(slotsOf(checkLink.planned)).toEqual(["end", "start"]);
    expect(slotsOf(checkLink.hello)).toEqual(["name"]);
    expect(slotsOf(checkLink.done)).toEqual(["name"]);
    expect(slotsOf(shiftLinks.title)).toEqual(["name"]);
    expect(slotsOf(shiftLinks.expires)).toEqual(["time"]);
    expect(slotsOf(shiftCalls.credit)).toEqual(["amount", "duration"]);
    expect(slotsOf(shiftCalls.creditFor)).toEqual(["amount", "duration", "name"]);
    expect(slotsOf(shiftCalls.settings.quiet)).toEqual(["end", "start"]);
    expect(slotsOf(shiftCalls.settings.consented)).toEqual(["date", "name"]);
    for (const state of SHIFT_CALL_STATES) expect(slotsOf(shiftCalls.states[state]), state).toEqual(["parent"]);
  });

  it("word every state a call can be in, and every new reason a request can be refused for", async () => {
    const { dashboard } = await getDictionary(locale);
    expect(Object.keys(dashboard.shiftCalls.states).toSorted()).toEqual([...SHIFT_CALL_STATES].toSorted());
    expect(Object.keys(dashboard.shifts.errors).toSorted()).toEqual(Object.keys(SHIFT_FAILURES).toSorted());
  });

  it("keep the parent's agreement to the call as one sentence a person can read before ticking it", async () => {
    const { consent } = (await getDictionary(locale)).dashboard.shiftCalls.settings;
    expect(consent.length).toBeGreaterThan(60);
    expect(consent).toContain("Kin");
  });
});

describe("the words after a tap", () => {
  const check = { action: "in", turned: true, name: "Amara", timezone: "America/New_York", startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T20:00:00.000Z", checkedInAt: "2026-10-30T14:03:00.000Z", checkedOutAt: null } as const;

  it("name the person and the time of the tap, and say a tap made twice was already recorded", () => {
    const first = checkWords(english.checkLink, "en", check);
    expect(first.text).toMatch(/^Checked in at \d{1,2}:\d{2} [AP]M\. Thank you, Amara\.$/);
    expect(first.planned).toMatch(/^Planned visit: .* to .*\.$/);
    expect(checkWords(english.checkLink, "en", { ...check, turned: false }).text).toMatch(/^You were already checked in at /);
  });

  it("tell the planned times on the circle's clock, not the phone's", () => {
    const planned = { startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T20:00:00.000Z" };
    expect(plannedWords(english.checkLink, "en", { ...planned, timezone: "America/New_York" })).toBe("Planned visit: 10:00 AM to 4:00 PM.");
    expect(plannedWords(english.checkLink, "en", { ...planned, timezone: "Asia/Tokyo" })).toBe("Planned visit: 11:00 PM to 5:00 AM.");
    expect(checkWords(english.checkLink, "en", { ...check, timezone: "Asia/Tokyo" }).text).toContain("11:03 PM");
  });

  it("tell the family will be told on a check-out", () => {
    const out = checkWords(english.checkLink, "en", { ...check, action: "out", checkedOutAt: "2026-10-30T20:01:00.000Z" });
    expect(out.text).toMatch(/Thank you, Amara\. The family will be told\.$/);
  });
});
