import { settlePeriod, type Agreement, type LedgerEntry, type SettlementPlan } from "@kin/domain";

import { chainHashes, genesisHash } from "./chain.ts";

export const BUNDLE_FORMAT = "kin-audit-bundle/1";

/** A sentence Kin showed people about one entry, kept so a second reader can check its figures. */
export type Wording = { readonly entryId: string; readonly text: string };

/** A settlement as Kin worked it out, with what is needed to work it out again from the entries alone. */
export type SettlementClaim = {
  readonly period: string;
  readonly agreement: Agreement;
  /** What PayPal is assumed to charge to send one payout. */
  readonly payoutFeeCents: number;
  readonly plan: SettlementPlan;
};

/** The audit export: the circle's ledger with its hash chain, what Kin said about it and the settlements it claims. */
export type AuditBundle = {
  readonly format: typeof BUNDLE_FORMAT;
  readonly circleId: string;
  readonly currency: string;
  readonly generatedOn: string;
  readonly entries: readonly LedgerEntry[];
  /** One hash per entry, in order. */
  readonly hashes: readonly string[];
  /** The last hash. Write it down: any later export must still contain it. */
  readonly head: string;
  readonly wording: readonly Wording[];
  readonly settlements: readonly SettlementClaim[];
};

export type BundleInput = {
  readonly circleId: string;
  readonly currency: string;
  readonly generatedOn: string;
  readonly entries: readonly LedgerEntry[];
  readonly wording: readonly Wording[];
  readonly settlements: readonly SettlementClaim[];
};

export function buildBundle(input: BundleInput): AuditBundle {
  const hashes = chainHashes(input.circleId, input.entries);
  return { format: BUNDLE_FORMAT, ...input, hashes, head: hashes.at(-1) ?? genesisHash(input.circleId) };
}

/** The claim for one period, worked out now from the entries, so the export can be checked against a later recomputation. */
export function claimSettlement(entries: readonly LedgerEntry[], circleId: string, currency: string, agreement: Agreement, period: string, payoutFeeCents: number): SettlementClaim {
  const { plan } = settlePeriod({ ledger: { circleId, currency, entries }, agreement, period, payoutFee: () => payoutFeeCents });
  return { period, agreement, payoutFeeCents, plan };
}

export class BundleFormatError extends Error {
  readonly retryable = false;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";

/**
 * Reads JSON into a bundle. It checks the shape only: what the entries say is
 * for the verifier to judge, so a forged entry reaches it and is reported.
 */
export function parseBundle(json: string): AuditBundle {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new BundleFormatError("The file is not JSON");
  }
  if (!isRecord(value) || value["format"] !== BUNDLE_FORMAT) throw new BundleFormatError(`The file is not a ${BUNDLE_FORMAT} export`);
  const { circleId, currency, generatedOn, entries, hashes, head, wording, settlements } = value;
  if (!isText(circleId) || !isText(currency) || !isText(generatedOn) || !isText(head)) throw new BundleFormatError("The export lacks its circle, currency, date or head");
  if (!Array.isArray(entries) || !entries.every(isEntryShape)) throw new BundleFormatError("The export's entries are malformed");
  if (!Array.isArray(hashes) || !hashes.every(isText)) throw new BundleFormatError("The export's hashes are malformed");
  if (!Array.isArray(wording) || !wording.every((each) => isRecord(each) && isText(each["entryId"]) && isText(each["text"]))) throw new BundleFormatError("The export's wording is malformed");
  if (!Array.isArray(settlements) || !settlements.every(isRecord)) throw new BundleFormatError("The export's settlements are malformed");
  return value as AuditBundle;
}

function isEntryShape(value: unknown): value is LedgerEntry {
  if (!isRecord(value) || !isRecord(value["source"]) || !Array.isArray(value["lines"])) return false;
  const texts = ["id", "circleId", "kind", "occurredOn", "period", "description", "currency"] as const;
  return (
    texts.every((key) => isText(value[key])) &&
    isText(value["source"]["type"]) &&
    isText(value["source"]["id"]) &&
    typeof value["simulated"] === "boolean" &&
    (value["reverses"] === null || isText(value["reverses"])) &&
    value["lines"].every((line) => isRecord(line) && isText(line["account"]) && (line["direction"] === "debit" || line["direction"] === "credit") && Number.isSafeInteger(line["cents"]))
  );
}
