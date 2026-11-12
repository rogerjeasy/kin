import type { AgDataSourcesDefinition, AgFieldDefinition } from "ag-studio";

import type { StudioData, StudioFairnessRow, StudioLedgerRow } from "@/content/circle/studio-data";
import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";

import type { KinRegistry } from "./studio-widgets";

export type StudioCopy = Dictionary["dashboard"]["studio"];

/** The two tables, as AG Studio names them in a field reference such as `ledger.inCents`. */
export const LEDGER = "ledger";
export const FAIRNESS = "fairness";

type FieldKey<Row> = Extract<keyof Row, string>;

/**
 * Money is whole cents and only ever summed, counted or compared, so AG Studio
 * works on exact integers. A figure is written by Kin's one money formatter;
 * the only value that is not whole cents is a chart's own axis tick or an
 * average a person asked for, which is shown to the nearest cent.
 */
export const writeMoney = (format: Formatters) => (value: number) => format.money(Number.isSafeInteger(value) ? value : Math.round(value));

const moneyField = <Row>(id: FieldKey<Row>, name: string, format: Formatters): AgFieldDefinition<KinRegistry> => ({
  id,
  name,
  format: "integerFormat",
  createValueFormatter: () => writeMoney(format),
});

const textField = <Row>(id: FieldKey<Row>, name: string, hide = false): AgFieldDefinition<KinRegistry> => ({ id, name, format: "textFormat", ...(hide ? { hide } : {}) });

/** "2026-10" groups and sorts as time does, and reads as "October 2026". */
export const writeMonth = (format: Formatters) => (value: string) => (/^\d{4}-\d{2}$/u.test(value) ? format.month(value) : value);

const monthField = <Row>(id: FieldKey<Row>, name: string, format: Formatters): AgFieldDefinition<KinRegistry> => ({
  id,
  name,
  format: "textFormat",
  createValueFormatter: () => writeMonth(format),
});

function ledgerFields(copy: StudioCopy, format: Formatters): AgFieldDefinition<KinRegistry>[] {
  const { fields } = copy;
  return [
    textField<StudioLedgerRow>("id", fields.id, true),
    { id: "day", name: fields.day, format: "dateFormat" },
    monthField<StudioLedgerRow>("month", fields.month, format),
    textField<StudioLedgerRow>("kind", fields.kind),
    textField<StudioLedgerRow>("person", fields.person),
    textField<StudioLedgerRow>("category", fields.category),
    moneyField<StudioLedgerRow>("amountCents", fields.amount, format),
    moneyField<StudioLedgerRow>("inCents", fields.moneyIn, format),
    moneyField<StudioLedgerRow>("outCents", fields.moneyOut, format),
    moneyField<StudioLedgerRow>("feeCents", fields.fee, format),
    moneyField<StudioLedgerRow>("caregiverPayCents", fields.caregiverPay, format),
    textField<StudioLedgerRow>("caregiver", fields.caregiver),
    textField<StudioLedgerRow>("proof", fields.proof),
    { id: "simulated", name: fields.simulated, format: "booleanFormat" },
    { id: "paypalVerified", name: fields.paypalVerified, format: "booleanFormat" },
    textField<StudioLedgerRow>("paypalId", fields.paypalId),
  ];
}

function fairnessFields(copy: StudioCopy, format: Formatters): AgFieldDefinition<KinRegistry>[] {
  const { fields } = copy;
  return [
    monthField<StudioFairnessRow>("month", fields.month, format),
    textField<StudioFairnessRow>("member", fields.member),
    { id: "shareBps", name: fields.share, format: "integerFormat", createValueFormatter: () => (value) => format.share(value) },
    { id: "shareIndex", name: fields.shareIndex, format: "integerFormat", hide: true },
    moneyField<StudioFairnessRow>("givenCents", fields.given, format),
    moneyField<StudioFairnessRow>("agreedCents", fields.agreed, format),
    moneyField<StudioFairnessRow>("positionCents", fields.position, format),
  ];
}

/** The record as AG Studio's data: the rows exactly as the server gave them, with Kin's names and formatters on every field. */
export function studioSources(data: StudioData, copy: StudioCopy, format: Formatters): AgDataSourcesDefinition<KinRegistry> {
  return {
    sources: [
      { id: LEDGER, name: copy.tables.ledger, data: [...data.ledger], fields: ledgerFields(copy, format) },
      { id: FAIRNESS, name: copy.tables.fairness, data: [...data.fairness], fields: fairnessFields(copy, format) },
    ],
  };
}

/** Every field the studio defines, as `table.field`: what a widget may refer to. */
export function studioFieldIds(sources: AgDataSourcesDefinition<KinRegistry>): Set<string> {
  return new Set(sources.sources.flatMap((source) => ("fields" in source && Array.isArray(source.fields) ? source.fields.map((field: { id: string }) => `${source.id}.${field.id}`) : [])));
}
