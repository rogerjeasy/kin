import { checkInvoiceLine, type BillState, type InvoiceLineFlag } from "@kin/domain";
import type { AgencyInvoiceRecord, AgencyInvoiceStoredRefusal, CircleSnapshot } from "@kin/db";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

/**
 * An agency's invoice as the family's screens show it, worded from the
 * record. Each line is held against Kin's own calendar by the domain's rule
 * (`checkInvoiceLine`); the agency's figures are shown as the agency's.
 */

export type InvoiceLineView = { readonly position: number; readonly visit: string; readonly minutes: string; readonly amount: string; readonly flags: readonly InvoiceLineFlag[] };

export type InvoiceView = {
  readonly id: string;
  readonly billId: string;
  readonly agency: string;
  readonly number: string;
  readonly period: string;
  readonly due: string;
  readonly total: string;
  readonly paypalEmail: string | null;
  readonly billState: BillState | null;
  readonly seeded: boolean;
  readonly received: string;
  readonly lines: readonly InvoiceLineView[];
};

export type RefusedInvoiceView = { readonly id: string; readonly agency: string; readonly refusal: AgencyInvoiceStoredRefusal; readonly received: string };

type Input = {
  readonly invoices: readonly AgencyInvoiceRecord[];
  readonly agencyOf: (agencyKeyId: string) => string;
  readonly circle: CircleSnapshot;
  readonly copy: Dictionary["dashboard"]["bills"]["invoices"];
  readonly kinds: Dictionary["dashboard"]["shifts"]["kinds"];
  readonly format: Formatters;
};

/** The accepted invoices, each with its lines checked against the calendar. */
export function invoiceViews({ invoices, agencyOf, circle, copy, kinds, format }: Input): InvoiceView[] {
  const shifts = circle.shifts.map((shift) => ({ ...shift, cancelled: shift.state === "cancelled" }));
  const member = (id: string | null) => (id === null ? null : (circle.members.find((each) => each.id === id)?.displayName ?? null));
  return invoices.flatMap((invoice): InvoiceView[] => {
    if (invoice.state !== "accepted" || invoice.billId === null || invoice.invoiceNumber === null) return [];
    const bill = circle.bills.find((each) => each.id === invoice.billId);
    return [
      {
        id: invoice.id,
        billId: invoice.billId,
        // The payee's name, as the family may have corrected it on review; the key's name before.
        agency: circle.payees.find((payee) => payee.id === bill?.payeeId)?.name ?? agencyOf(invoice.agencyKeyId),
        number: invoice.invoiceNumber,
        period: invoice.periodStart && invoice.periodEnd ? fill(copy.period, { from: format.day(invoice.periodStart), to: format.day(invoice.periodEnd) }) : "",
        due: invoice.dueOn ? fill(copy.due, { day: format.day(invoice.dueOn) }) : "",
        total: format.money(invoice.totalCents ?? 0),
        paypalEmail: invoice.paypalEmail,
        billState: bill?.state ?? null,
        seeded: invoice.seeded,
        received: format.dateTime(invoice.receivedAt),
        lines: invoice.lines.map((line): InvoiceLineView => {
          const { visit } = line;
          const flags =
            visit.kind === null || visit.startsAt === null || visit.endsAt === null
              ? (["no_family_word"] as const)
              : checkInvoiceLine(line, { memberId: visit.caregiverMemberId, kind: visit.kind, startsAt: visit.startsAt, endsAt: visit.endsAt }, shifts).flags;
          const caregiver = member(visit.caregiverMemberId) ?? visit.caregiverName ?? "";
          const when = visit.kind === null || visit.startsAt === null || visit.endsAt === null ? "" : fill(copy.when, { kind: kinds[visit.kind], from: format.dateTime(visit.startsAt), to: format.time(visit.endsAt) });
          return { position: line.position, visit: fill(copy.line, { caregiver, when }), minutes: fill(copy.minutes, { count: format.count(line.minutes) }), amount: format.money(line.amountCents), flags };
        }),
      },
    ];
  });
}

/** The invoices Kin refused, with why, for the agency's connection screen. */
export function refusedInvoiceViews(invoices: readonly AgencyInvoiceRecord[], agencyOf: (agencyKeyId: string) => string, format: Formatters): RefusedInvoiceView[] {
  return invoices.flatMap((invoice) => (invoice.state === "refused" && invoice.refusal !== null ? [{ id: invoice.id, agency: agencyOf(invoice.agencyKeyId), refusal: invoice.refusal, received: format.dateTime(invoice.receivedAt) }] : []));
}
