import { describe, expect, it } from "vitest";
import english from "@/i18n/dictionaries/en.json";
import { parseBillingResponse } from "./billing-response";

const errors = english.dashboard.caregiverBilling.errors;
describe("the billing response boundary", () => {
  it("refuses malformed success and unknown error payloads", () => {
    for (const input of [null, {}, { ok: true }, { ok: false, reason: "provider-secret" }, { ok: true, bill: { cents: 1.5 } }]) {
      expect(parseBillingResponse(input, errors)).toEqual({ ok: false, reason: "unavailable" });
    }
  });
  it("accepts known outcomes and server-valued bill lines without calculating amounts", () => {
    expect(parseBillingResponse({ ok: false, reason: "duplicate" }, errors)).toEqual({ ok: false, reason: "duplicate" });
    const input = { ok: true, submissionKey: "e57341b3-198d-44cf-a930-3ac37b997c2a", bill: { details: { version: 1, currency: "USD", rateCentsPerHour: 2200, visits: [{ date: "2026-10-01", minutes: 240 }] }, lines: [{ date: "2026-10-01", minutes: 240, cents: 8800 }], cents: 8800 } };
    expect(parseBillingResponse(input, errors)).toEqual(input);
  });
  it("reads days Claude filled in only when every one is a real day in whole minutes", () => {
    const good = { ok: true, described: true, visits: [{ date: "2026-10-26", minutes: 240 }], unclear: ["Tuesday"], dropped: 1 };
    expect(parseBillingResponse(good, errors)).toEqual(good);
    for (const visits of [[{ date: "Monday", minutes: 240 }], [{ date: "2026-10-26", minutes: 0 }], [{ date: "2026-10-26", minutes: 1441 }], [{ date: "2026-10-26", minutes: 2.5 }], "many"]) {
      expect(parseBillingResponse({ ...good, visits }, errors)).toEqual({ ok: false, reason: "unavailable" });
    }
  });
});

