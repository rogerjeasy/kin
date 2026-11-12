import { centsFromDecimal } from "@kin/domain";

import type { PayPalClient } from "./client.ts";
import { asRecord, optionalRecord, optionalText, PayPalShapeError, recordList, requiredText, type JsonRecord } from "./json.ts";

/*
 * PayPal's Transaction Search API (`GET /v1/reporting/transactions`), used to
 * prove from PayPal's own record that a payout left the pool, for the
 * look-back packet a family gives its attorney. Read before changing it.
 *
 * Checked against PayPal's OpenAPI document on 9 November 2026
 * (https://developer.paypal.com/docs/api/transaction-search/v1/schema.json,
 * reference page https://developer.paypal.com/api/transaction-search/v1/search-get):
 * - `start_date` and `end_date` are required RFC 3339 date-times (seconds
 *   required) and "the maximum supported range is 31 days".
 * - `transaction_id` filters by PayPal transaction ID, but IDs "are not unique
 *   in the reporting system", so two records can share one.
 * - `fields` defaults to `transaction_info`; `payer_info` adds the counterparty.
 * - "It takes a maximum of three hours for executed transactions to appear",
 *   so a payout paid minutes ago is not found yet. An empty answer is "not
 *   yet", never "it did not happen": callers must say so.
 * - `transaction_status` is `D` denied, `P` pending, `S` successful, `V` fully
 *   reversed and refunded.
 * - The payout item `GET /v1/payments/payouts-item/{id}` carries the
 *   `transaction_id` of the payout (https://developer.paypal.com/docs/api/payments.payouts-batch/v1/schema.json).
 *
 * Checked against the sandbox on 11 November 2026 (a 5.00 payout through
 * Kin's adapter, fixtures/transaction-search-sandbox-2026-11-11.json):
 * - The sign of `transaction_amount`, which the schema does not state: the
 *   payout read `-5.00`, so a leading minus means money left the searched
 *   account, and its fee read `-0.25` (Kin keeps the fee as a positive amount).
 *   Its event code was `T0001`, not the `T0400` the documented shape assumed.
 * - The pool's sandbox app has Transaction Search switched on. An app without
 *   it (Features, "Transaction search", in the PayPal developer dashboard) is
 *   refused with a 403 and the PayPalError says so.
 */

export type TransactionRecord = {
  readonly transactionId: string;
  /** PayPal's status code: `S` successful, `P` pending, `D` denied, `V` reversed. */
  readonly status: string;
  /** PayPal's event code, such as `T0400`. Empty text when PayPal sent none. */
  readonly eventCode: string;
  /** Signed: negative when money left the searched account. */
  readonly amountCents: number;
  readonly currency: string;
  /** PayPal's `transaction_initiation_date`, as sent. */
  readonly initiatedAt: string;
  /** The fee PayPal charged, as a positive amount, or null when it charged none. */
  readonly feeCents: number | null;
  /** The other party's address with its local part hidden, never the whole address. */
  readonly counterpartyEmailMasked: string | null;
  readonly counterpartyAccountId: string | null;
};

const WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

/** Hides an address's local part: `jane@example.com` becomes `j***@example.com`. */
export function maskEmail(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) return null;
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** Reads a decimal that may carry a leading minus, from its digits alone. */
function signedCents(text: string, currency: string, what: string): number {
  const negative = text.startsWith("-");
  try {
    const cents = centsFromDecimal(negative ? text.slice(1) : text, currency);
    return negative && cents !== 0 ? -cents : cents;
  } catch {
    throw new PayPalShapeError(what);
  }
}

function amountOf(record: JsonRecord, what: string): { cents: number; currency: string } {
  const currency = requiredText(record, "currency_code");
  return { cents: signedCents(requiredText(record, "value"), currency, what), currency };
}

function parseDetail(detail: JsonRecord): TransactionRecord {
  const info = asRecord(detail["transaction_info"], "transaction info");
  const amount = amountOf(asRecord(info["transaction_amount"], "transaction amount"), "transaction amount");
  const feeRecord = optionalRecord(info["fee_amount"]);
  const fee = feeRecord === null ? null : amountOf(feeRecord, "fee amount");
  const payer = optionalRecord(detail["payer_info"]);
  const email = optionalText(payer, "email_address");
  return {
    transactionId: requiredText(info, "transaction_id"),
    status: requiredText(info, "transaction_status"),
    eventCode: optionalText(info, "transaction_event_code") ?? "",
    amountCents: amount.cents,
    currency: amount.currency,
    initiatedAt: requiredText(info, "transaction_initiation_date"),
    feeCents: fee === null || fee.cents === 0 ? null : Math.abs(fee.cents),
    counterpartyEmailMasked: email === null ? null : maskEmail(email),
    counterpartyAccountId: optionalText(payer, "account_id"),
  };
}

/** Reads a Transaction Search answer. An answer with no `transaction_details` is an empty list. */
export function parseTransactionSearch(value: unknown): TransactionRecord[] {
  const record = asRecord(value, "transaction search");
  return recordList(record["transaction_details"]).map(parseDetail);
}

/** The transaction ID of a payout item read on its own (`GET /v1/payments/payouts-item/{id}`), or null while PayPal has none. */
export function parsePayoutItemTransactionId(value: unknown): string | null {
  return optionalText(asRecord(value, "payout item"), "transaction_id");
}

/** Money that went out of the pool and is final. A pending, denied or reversed record is not proof. */
export function leftThePool(record: TransactionRecord): boolean {
  return record.amountCents < 0 && record.status === "S";
}

/** The search path for one transaction ID, in a window of 15 days either side of `around` (30 days, inside PayPal's 31). */
export function transactionSearchPath(transactionId: string, around: Date): string {
  const second = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const query = new URLSearchParams({
    start_date: second(new Date(around.getTime() - WINDOW_MS)),
    end_date: second(new Date(around.getTime() + WINDOW_MS)),
    transaction_id: transactionId,
    fields: "transaction_info,payer_info",
  });
  return `/v1/reporting/transactions?${query.toString()}`;
}

/**
 * Looks one transaction up in PayPal's reporting. Null means PayPal returned
 * nothing, which includes "not yet available" (up to three hours): it never
 * means the money did not move. A PayPal refusal or outage is thrown as
 * `PayPalError`.
 */
export async function searchTransaction(client: PayPalClient, query: { readonly transactionId: string; readonly around: Date }): Promise<TransactionRecord | null> {
  const answer = await client.send({ method: "GET", path: transactionSearchPath(query.transactionId, query.around), operation: "transactions.search" });
  return parseTransactionSearch(answer).find((each) => each.transactionId === query.transactionId) ?? null;
}
