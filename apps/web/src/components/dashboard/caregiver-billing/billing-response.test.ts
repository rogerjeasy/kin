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
    const good = { ok: true, described: true, visits: [{ date: "2026-10-26", minutes: 240, quotes: ["Monday, four hours"] }], unclear: ["Tuesday"], dropped: 1, provenance: { source: "claude", model: "us.anthropic.claude-opus-4-6-v1" } };
    expect(parseBillingResponse(good, errors)).toEqual(good);
    const day = { date: "2026-10-26", minutes: 240, quotes: [] };
    for (const visits of [[{ ...day, date: "Monday" }], [{ ...day, minutes: 0 }], [{ ...day, minutes: 1441 }], [{ ...day, minutes: 2.5 }], [{ ...day, quotes: [4] }], [{ date: "2026-10-26", minutes: 240 }], "many"]) {
      expect(parseBillingResponse({ ...good, visits }, errors)).toEqual({ ok: false, reason: "unavailable" });
    }
  });
  it("refuses days that do not say who read them, so a reading never passes without a badge", () => {
    const good = { ok: true, described: true, visits: [], unclear: [], dropped: 0 };
    expect(parseBillingResponse(good, errors)).toEqual({ ok: false, reason: "unavailable" });
    expect(parseBillingResponse({ ...good, provenance: { source: "claude" } }, errors)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("keeps the reason the model was not used, when it is one Kin knows", () => {
    expect(parseBillingResponse({ ok: false, reason: "model_unavailable", why: "model_busy" }, errors)).toEqual({ ok: false, reason: "model_unavailable", why: "model_busy" });
    expect(parseBillingResponse({ ok: false, reason: "model_unavailable", why: "provider says no" }, errors)).toEqual({ ok: false, reason: "model_unavailable" });
  });
});

