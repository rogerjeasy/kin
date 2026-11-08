import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";
import { slotsOf } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { SHIFT_FAILURES, askReasonText, durationText, failureText, priceText, turnWords } from "./shift-words";

const english = await getDictionary("en");
const format = formatters("en", "USD", "America/New_York");
const copy = english.dashboard.shifts;

describe.each(locales)("the %s words for shifts", (locale) => {
  it("word every reason a request can be refused for, and nothing else", async () => {
    const { shifts } = (await getDictionary(locale)).dashboard;
    expect(Object.keys(shifts.errors).toSorted()).toEqual(Object.keys(SHIFT_FAILURES).toSorted());
  });

  it("use no em dash and no empty sentence, in the screens or in the permission page", async () => {
    const { shifts, shiftPermissions } = (await getDictionary(locale)).dashboard;
    const texts = JSON.stringify([shifts, shiftPermissions]).match(/"[^"]*"/g) ?? [];
    expect(texts.length).toBeGreaterThan(100);
    for (const text of texts) expect(text).not.toMatch(/—|""/u);
  });

  it("fill each outcome's slots from the record, so no sentence names a figure of its own", async () => {
    const { shifts } = (await getDictionary(locale)).dashboard;
    expect(slotsOf(shifts.outcome.paid)).toEqual(["amount", "name", "parent", "wallet"]);
    expect(slotsOf(shifts.price)).toEqual(["amount", "duration", "rate"]);
    expect(slotsOf(shifts.received.title)).toEqual(["amount", "wallet"]);
  });
});

describe("the words for a visit's length and price", () => {
  it("write whole minutes as hours and minutes, as the record has them", () => {
    expect(durationText(copy, format, 45)).toBe("45 min");
    expect(durationText(copy, format, 240)).toBe("4 h");
    expect(durationText(copy, format, 210)).toBe("3 h 30 min");
  });

  it("price a shift from its own record, and say nothing before it has one", () => {
    expect(priceText(copy, format, { cents: 14000, billableMinutes: 240, rateCentsPerHour: 3500 })).toBe("$140.00 for 4 h at $35.00 an hour");
    expect(priceText(copy, format, { cents: null, billableMinutes: null, rateCentsPerHour: null })).toBeNull();
  });
});

describe("the words for a refusal", () => {
  it("fall back to unavailable for a reason this version does not know", () => {
    expect(failureText(copy, "own_shift")).toBe("Nobody gives the family’s word for their own shift.");
    expect(failureText(copy, "something_new")).toBe(copy.errors.unavailable);
    expect(failureText(copy, "toString")).toBe(copy.errors.unavailable);
  });

  it("say why the family is asked, or that no permission was there to cover it", () => {
    expect(askReasonText(copy, "above_per_shift")).toBe("The shift is above the most the permission allows for one shift.");
    expect(askReasonText(copy, null)).toBe("No standing permission covers this caregiver.");
  });
});

describe("the words for what a tap brought about", () => {
  const who = { format, parent: "Rose", name: "Amara", wallet: "venmo" as const };

  it("tell the caregiver their pay is on its way to their own wallet, and the family to whom", () => {
    const outcome = { kind: "paid_by_permission", cents: 14000 } as const;
    expect(turnWords(copy, "confirm", outcome, { ...who, toYou: true }).text).toBe("$140.00 is approved by Rose’s standing permission and is on its way to you by Venmo.");
    expect(turnWords(copy, "confirm", outcome, { ...who, toYou: false }).text).toBe("$140.00 is approved by Rose’s standing permission and is on its way to Amara by Venmo.");
  });

  it("send a payment outside the permission to the approvals, with the reason", () => {
    expect(turnWords(copy, "confirm", { kind: "asks_family", cents: 17600, askReason: "over_daily_hours" }, { ...who, toYou: false })).toEqual({
      text: "$176.00 goes to the family for approval, because it is outside the standing permission.",
      detail: "The shift is more hours than the permission allows in a day.",
      toApprovals: true,
    });
  });

  it("say what each key now waits for, and why a payment is on hold", () => {
    expect(turnWords(copy, "check_out", { kind: "waiting" }, { ...who, toYou: true }).text).toBe("Checked out. Now Kin waits for Rose’s word.");
    expect(turnWords(copy, "confirm", { kind: "waiting" }, { ...who, toYou: false }).text).toBe("Thank you. Now Kin waits for Amara to check out.");
    expect(turnWords(copy, "confirm", { kind: "held", reason: "paused" }, { ...who, toYou: false }).text).toBe("Both keys are in, but the payment is on hold. The circle is paused, so nothing is paid now.");
  });
});
