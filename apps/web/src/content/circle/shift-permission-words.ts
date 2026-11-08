import type { ShiftPermissionTerms } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { durationText, type ShiftCopy } from "./shift-words";

export type PermissionCopy = Dictionary["dashboard"]["shiftPermissions"];

/** What Kin reads back to the parent: the terms in her own order, every figure from the record. */
export function readBack(copy: PermissionCopy, shifts: ShiftCopy, format: Formatters, terms: ShiftPermissionTerms, caregiver: string): string {
  return fill(copy.readBack, {
    name: caregiver,
    hours: durationText(shifts, format, terms.maxMinutesPerDay),
    perShift: format.money(terms.perShiftCents),
    from: format.dayWithYear(terms.validFrom),
    until: format.dayWithYear(terms.expiresOn),
  });
}

/** The plain-words notice that she is saying yes ahead of time to amounts above what she usually decides herself. */
export function aboveUsualNotice(copy: PermissionCopy, shifts: ShiftCopy, format: Formatters, terms: ShiftPermissionTerms, parent: string, aboveUsualCents: number): string {
  return fill(copy.aboveUsual.notice, {
    parent,
    limit: format.money(terms.perShiftCents - aboveUsualCents),
    perShift: format.money(terms.perShiftCents),
    hours: durationText(shifts, format, terms.maxMinutesPerDay),
    until: format.dayWithYear(terms.expiresOn),
  });
}
