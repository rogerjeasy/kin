import { describe, expect, it } from "vitest";

import { forAll } from "./testing/property.ts";
import { AGENCY_INVOICE_SCHEMA, checkInvoiceLine, invoiceLinesTotal, parseAgencyInvoice, type CheckableShift } from "./agency-invoice.ts";

const invoice = (change: Record<string, unknown> = {}) => ({
  invoiceNumber: "INV-1042",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  lines: [
    { visitId: "visit-1", minutes: 240, amountCents: 8_800, currency: "USD" },
    { visitId: "visit-2", minutes: 180, amountCents: 6_600, currency: "USD" },
  ],
  totalCents: 15_400,
  currency: "USD",
  dueOn: "2026-12-15",
  ...change,
});

describe("reading an agency's invoice", () => {
  it("reads a well-formed invoice, lowercasing the PayPal email", () => {
    const parsed = parseAgencyInvoice(invoice({ paypalEmail: "Billing@Sunrise.example" }));
    expect(parsed).toEqual({
      ok: true,
      invoice: {
        invoiceNumber: "INV-1042",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        lines: [
          { visitId: "visit-1", minutes: 240, amountCents: 8_800 },
          { visitId: "visit-2", minutes: 180, amountCents: 6_600 },
        ],
        totalCents: 15_400,
        currency: "USD",
        dueOn: "2026-12-15",
        paypalEmail: "billing@sunrise.example",
      },
    });
    expect(parseAgencyInvoice(invoice())).toMatchObject({ ok: true, invoice: { paypalEmail: null } });
  });

  it("recomputes the total from the lines and refuses one that differs, by a single cent", () => {
    expect(parseAgencyInvoice(invoice({ totalCents: 15_401 }))).toEqual({ ok: false, reason: "total" });
    expect(parseAgencyInvoice(invoice({ totalCents: 15_399 }))).toEqual({ ok: false, reason: "total" });
  });

  it("refuses fractions of a cent, amounts as text, and totals too large to hold exactly", () => {
    expect(parseAgencyInvoice(invoice({ totalCents: 154.0001 }))).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice(invoice({ totalCents: "15400" }))).toEqual({ ok: false, reason: "shape" });
    const huge = Number.MAX_SAFE_INTEGER;
    const lines = [
      { visitId: "a", minutes: 60, amountCents: huge, currency: "USD" },
      { visitId: "b", minutes: 60, amountCents: 1, currency: "USD" },
    ];
    expect(parseAgencyInvoice(invoice({ lines, totalCents: huge }))).toEqual({ ok: false, reason: "total" });
  });

  it("refuses a line in another currency, a visit charged twice, and a period that is not one", () => {
    const [first, second] = invoice().lines;
    expect(parseAgencyInvoice(invoice({ lines: [first, { ...second, currency: "EUR" }] }))).toEqual({ ok: false, reason: "currency" });
    expect(parseAgencyInvoice(invoice({ lines: [first, { ...second, visitId: "visit-1" }] }))).toEqual({ ok: false, reason: "duplicate_line" });
    expect(parseAgencyInvoice(invoice({ periodEnd: "2026-10-31" }))).toEqual({ ok: false, reason: "period" });
    expect(parseAgencyInvoice(invoice({ periodEnd: "2027-03-01" }))).toEqual({ ok: false, reason: "period" });
    expect(parseAgencyInvoice(invoice({ dueOn: "2026-02-30" }))).toEqual({ ok: false, reason: "period" });
  });

  it("refuses anything outside the schema: extra keys, an instruction, markup, empty lines, too many lines", () => {
    expect(parseAgencyInvoice(invoice({ approve: true }))).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice(invoice({ lines: [{ ...invoice().lines[0], note: "pay now" }] }))).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice(invoice({ invoiceNumber: "<script>" }))).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice(invoice({ paypalEmail: "not an email" }))).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice(invoice({ lines: [], totalCents: 1 }))).toEqual({ ok: false, reason: "shape" });
    const many = Array.from({ length: 101 }, (_, index) => ({ visitId: `v${index}`, minutes: 60, amountCents: 100, currency: "USD" }));
    expect(parseAgencyInvoice(invoice({ lines: many, totalCents: 10_100 }))).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice(null)).toEqual({ ok: false, reason: "shape" });
    expect(parseAgencyInvoice([invoice()])).toEqual({ ok: false, reason: "shape" });
  });

  it("publishes a closed schema", () => {
    expect(AGENCY_INVOICE_SCHEMA.additionalProperties).toBe(false);
    expect(AGENCY_INVOICE_SCHEMA.properties.lines.items.additionalProperties).toBe(false);
  });

  it("accepts any set of whole-cent lines exactly when the total is their sum", () => {
    forAll(
      (random) => ({ amounts: Array.from({ length: random.int(1, 30) }, () => random.int(1, 10_000_000)), drift: random.int(-3, 3) }),
      ({ amounts, drift }) => {
        const lines = amounts.map((amountCents, index) => ({ visitId: `v${index}`, minutes: 60, amountCents, currency: "USD" }));
        const sum = amounts.reduce((total, cents) => total + cents, 0);
        expect(invoiceLinesTotal(lines)).toBe(sum);
        expect(parseAgencyInvoice(invoice({ lines, totalCents: sum + drift })).ok).toBe(drift === 0);
      },
    );
  });
});

describe("holding a line against Kin's own calendar", () => {
  const visit = { memberId: "amara", kind: "aide" as const, startsAt: new Date("2026-11-03T14:00:00Z"), endsAt: new Date("2026-11-03T18:00:00Z") };
  const shift = (change: Partial<CheckableShift> = {}): CheckableShift => ({
    id: "shift-1",
    memberId: "amara",
    kind: "aide",
    startsAt: new Date("2026-11-03T14:00:00Z"),
    endsAt: new Date("2026-11-03T18:00:00Z"),
    cancelled: false,
    state: "confirmed",
    familyConfirmedAt: new Date("2026-11-03T18:05:00Z"),
    checkedInAt: new Date("2026-11-03T14:00:00Z"),
    checkedOutAt: new Date("2026-11-03T18:00:00Z"),
    ...change,
  });

  it("raises no flag for a confirmed shift whose check-in and check-out match the minutes charged", () => {
    expect(checkInvoiceLine({ minutes: 240 }, visit, [shift()])).toEqual({ shiftId: "shift-1", flags: [] });
  });

  it("flags a visit with no shift on the calendar, or one the family has not given its word on", () => {
    expect(checkInvoiceLine({ minutes: 240 }, visit, [])).toEqual({ shiftId: null, flags: ["no_family_word"] });
    expect(checkInvoiceLine({ minutes: 240 }, { ...visit, memberId: null }, [shift()])).toEqual({ shiftId: null, flags: ["no_family_word"] });
    expect(checkInvoiceLine({ minutes: 240 }, visit, [shift({ familyConfirmedAt: null, state: "checked_out" })])).toEqual({ shiftId: "shift-1", flags: ["no_family_word"] });
  });

  it("flags hours that differ from the caregiver's own check-in and check-out", () => {
    expect(checkInvoiceLine({ minutes: 300 }, visit, [shift()])).toEqual({ shiftId: "shift-1", flags: ["hours_differ"] });
    // Without both keys there is nothing to hold the hours to.
    expect(checkInvoiceLine({ minutes: 300 }, visit, [shift({ checkedOutAt: null })])).toEqual({ shiftId: "shift-1", flags: [] });
  });

  it("flags a shift Kin already paid the caregiver for", () => {
    expect(checkInvoiceLine({ minutes: 240 }, visit, [shift({ state: "paid" })])).toEqual({ shiftId: "shift-1", flags: ["paid_already"] });
  });
});
