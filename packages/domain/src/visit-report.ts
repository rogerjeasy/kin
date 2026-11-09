import { MAX_SHIFT_MINUTES, SHIFT_KINDS, type ShiftKind } from "./shift.ts";

/**
 * A visit a home-care agency's scheduling software reports to Kin
 * (docs/architecture.md section 13.5). It is evidence, never a payment: it
 * names a caregiver, the planned times and, where the agency's electronic
 * visit verification has them, the times the aide checked in and out. Kin
 * shows it beside the shift on its own calendar; the family still gives its
 * word on the shift, and only a shift the family confirmed is ever paid.
 *
 * The schema is written once, here, as JSON Schema. The API's OpenAPI
 * document publishes it as it is, and `parseVisitReport` checks a request
 * against the same object, so the two cannot disagree.
 */

const NO_MARKUP = "^[^<>{}\\n\\r]+$";
const DATE_TIME = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})$";

type StringField = { readonly type: "string"; readonly description: string; readonly maxLength: number; readonly pattern?: string; readonly enum?: readonly string[]; readonly format?: "date-time" };

export const VISIT_REPORT_SCHEMA = {
  type: "object",
  title: "VisitReport",
  description: "One visit, as the agency's scheduling or visit-verification software recorded it. Kin keeps it as evidence beside its own shift; it pays nothing.",
  additionalProperties: false,
  required: ["externalId", "caregiver", "kind", "startsAt", "endsAt"],
  properties: {
    externalId: { type: "string", description: "The agency's own ID for this visit. Sending the same ID and body again changes nothing.", maxLength: 80, pattern: "^[A-Za-z0-9._:-]+$" },
    caregiver: { type: "string", description: "The aide's name as the family's circle knows them. Kin matches it to one of the circle's caregivers.", maxLength: 80, pattern: NO_MARKUP },
    kind: { type: "string", description: "What the visit was, in Kin's words for a shift.", maxLength: 12, enum: SHIFT_KINDS },
    startsAt: { type: "string", format: "date-time", description: "When the visit was planned to begin (RFC 3339, with an offset).", maxLength: 40, pattern: DATE_TIME },
    endsAt: { type: "string", format: "date-time", description: "When the visit was planned to end.", maxLength: 40, pattern: DATE_TIME },
    checkedInAt: { type: "string", format: "date-time", description: "When the aide checked in, if the agency verified it.", maxLength: 40, pattern: DATE_TIME },
    checkedOutAt: { type: "string", format: "date-time", description: "When the aide checked out, if the agency verified it. Requires checkedInAt.", maxLength: 40, pattern: DATE_TIME },
    note: { type: "string", description: "A short note from the agency. Shown to the family as the agency's words, never acted on.", maxLength: 280, pattern: NO_MARKUP },
  },
} as const satisfies {
  readonly type: "object";
  readonly title: string;
  readonly description: string;
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, StringField>>;
};

export type VisitReport = {
  readonly externalId: string;
  readonly caregiver: string;
  readonly kind: ShiftKind;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkedInAt: Date | null;
  readonly checkedOutAt: Date | null;
  readonly note: string | null;
  /** Whole minutes the agency says the aide worked, from its check-in and check-out, or the planned minutes without them. */
  readonly minutes: number;
};

/** `shape`: not the schema. `times`: the times do not make one visit of at most a day. */
export type VisitReportRefusal = "shape" | "times";

const MINUTE_MS = 60_000;
type Field = keyof typeof VISIT_REPORT_SCHEMA.properties;

function validField(field: StringField, value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > field.maxLength || value.trim() !== value) return false;
  if (field.enum !== undefined && !field.enum.includes(value)) return false;
  return field.pattern === undefined || new RegExp(field.pattern, "u").test(value);
}

/** Only the schema's keys, every required one, each of its type, size and pattern. */
function followsSchema(input: unknown): input is Readonly<Partial<Record<Field, string>>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const properties: Readonly<Record<string, StringField>> = VISIT_REPORT_SCHEMA.properties;
  const entries = Object.entries(input);
  if (entries.some(([key, value]) => !Object.hasOwn(properties, key) || !validField(properties[key] as StringField, value))) return false;
  return VISIT_REPORT_SCHEMA.required.every((key) => Object.hasOwn(input, key));
}

const instant = (text: string | undefined): Date | null => {
  if (text === undefined) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const minutesBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);

/** A visit report, or why it is refused. Nothing is coerced or trimmed into shape. */
export function parseVisitReport(input: unknown): { readonly ok: true; readonly report: VisitReport } | { readonly ok: false; readonly reason: VisitReportRefusal } {
  if (!followsSchema(input)) return { ok: false, reason: "shape" };
  const startsAt = instant(input.startsAt);
  const endsAt = instant(input.endsAt);
  const checkedInAt = instant(input.checkedInAt);
  const checkedOutAt = instant(input.checkedOutAt);
  if (startsAt === null || endsAt === null || (input.checkedInAt !== undefined && checkedInAt === null) || (input.checkedOutAt !== undefined && checkedOutAt === null)) return { ok: false, reason: "times" };
  const planned = minutesBetween(startsAt, endsAt);
  if (planned <= 0 || planned > MAX_SHIFT_MINUTES) return { ok: false, reason: "times" };
  if (checkedOutAt !== null && checkedInAt === null) return { ok: false, reason: "times" };
  const worked = checkedInAt !== null && checkedOutAt !== null ? minutesBetween(checkedInAt, checkedOutAt) : null;
  if (worked !== null && (worked <= 0 || worked > MAX_SHIFT_MINUTES)) return { ok: false, reason: "times" };
  return {
    ok: true,
    report: {
      externalId: input.externalId as string,
      caregiver: input.caregiver as string,
      kind: input.kind as ShiftKind,
      startsAt,
      endsAt,
      checkedInAt,
      checkedOutAt,
      note: input.note ?? null,
      minutes: worked ?? planned,
    },
  };
}

/** A shift on Kin's calendar, as far as matching a report needs it. */
export type ReportableShift = { readonly id: string; readonly memberId: string; readonly kind: ShiftKind; readonly startsAt: Date; readonly endsAt: Date; readonly cancelled: boolean };

/**
 * The shift on Kin's calendar a report is about: the same caregiver and kind,
 * not cancelled, overlapping the reported time, and of those the one that
 * overlaps most (the earliest on a tie). `null` when none does: the report is
 * then only the agency's word, and nothing on Kin's calendar is changed by it.
 */
export function matchVisitReport(report: { readonly memberId: string | null; readonly kind: ShiftKind; readonly startsAt: Date; readonly endsAt: Date }, shifts: readonly ReportableShift[]): string | null {
  if (report.memberId === null) return null;
  let best: { readonly id: string; readonly overlap: number; readonly startsAt: number } | null = null;
  for (const shift of shifts) {
    if (shift.cancelled || shift.memberId !== report.memberId || shift.kind !== report.kind) continue;
    const overlap = Math.min(shift.endsAt.getTime(), report.endsAt.getTime()) - Math.max(shift.startsAt.getTime(), report.startsAt.getTime());
    if (overlap <= 0) continue;
    if (best === null || overlap > best.overlap || (overlap === best.overlap && shift.startsAt.getTime() < best.startsAt)) best = { id: shift.id, overlap, startsAt: shift.startsAt.getTime() };
  }
  return best?.id ?? null;
}
