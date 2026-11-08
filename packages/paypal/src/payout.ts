import { centsFromDecimal, decimalAmount, type Money } from "@kin/domain";

import { asRecord, optionalRecord, optionalText, PayPalShapeError, recordList, requiredText, type JsonRecord } from "./json.ts";

/*
 * Venmo payouts: what PayPal's documentation said on 8 November 2026, and what
 * the PayPal sandbox answered the same day. Read before changing how a Venmo
 * item is built.
 *
 * Observed in the sandbox on 8 November 2026 (`pnpm --filter @kin/paypal run
 * venmo:probe`, five one-item 1.00 USD batches through `payoutBody`, from the
 * pool's sandbox app to the project's own sandbox personal accounts)
 * - A Venmo item is refused outright: HTTP 400 `VALIDATION_ERROR`, detail
 *   field `items[0].recipient_wallet`, issue "Recipient wallet not supported in
 *   sandbox." It was the same for an EMAIL receiver, a `USER_HANDLE` with its
 *   `@`, a `USER_HANDLE` without it and a `PHONE` in E.164. The wallet is
 *   rejected before the receiver is read, so the sandbox cannot say whether any
 *   of those three forms is right. The recorded refusal is
 *   fixtures/payout-venmo-sandbox-refused-2026-11-08.json.
 * - The PayPal-wallet control (Kin's default body, unchanged) was accepted:
 *   201, the batch `PENDING` then `PROCESSING`, its item `PENDING`, and the
 *   read-back named `recipient_wallet: "PAYPAL"`.
 * - A forced failure (`ERRPYO002` in the note, on a Venmo item) was answered
 *   with 403 `SENDER_EMAIL_UNCONFIRMED` before the wallet was checked, so it
 *   says nothing about Venmo.
 * - So: no Venmo payout can be made, read back or failed in the sandbox. Kin's
 *   worker fails such a payout for good (`paypal_400`), and a demo circle's
 *   Venmo payout stays simulated (sandbox-route.ts). Every other statement
 *   below about Venmo comes from the documentation and stays UNVERIFIED.
 *
 * Sources
 * - Payout item schema: https://developer.paypal.com/api/payments.payouts-batch/v1/definitions/payout_item_request
 *   and the OpenAPI document https://developer.paypal.com/docs/api/payments.payouts-batch/v1/schema.json
 * - Integration guide: https://developer.paypal.com/docs/payouts/standard/integrate-api/
 * - Use Payouts to Venmo: https://developer.paypal.com/docs/payouts/standard/payouts-to-venmo
 *
 * What they agree on
 * - An item sets `recipient_wallet` to choose Venmo. The OpenAPI enum is
 *   `PAYPAL` | `VENMO` (default `PAYPAL`, pattern ^[0-9A-Z_]+$), and a payout
 *   response shows `"recipient_wallet": "PAYPAL"` in capitals (Kin recorded that
 *   in the sandbox on 26 October and again on 8 November 2026). Kin sends `VENMO`;
 *   the sandbox accepted the field's shape and refused only the wallet.
 * - Venmo payouts are "available only in the US". The only currency any
 *   Venmo example uses is USD, and no page names another, so Kin sends Venmo in
 *   USD only.
 * - The schema says Venmo payouts "require a 'note' string and a US mobile
 *   phone number". The note shows in the recipient's Venmo feed and follows
 *   their privacy settings, so Kin sends `application_context.social_feed_privacy:
 *   "PRIVATE"` (documented, and the documented default) to make that explicit.
 * - A recipient without a Venmo account is told how to create one and claim
 *   the payout: such an item reads `UNCLAIMED` until then, and `RETURNED` if
 *   not claimed within 30 days. `FAILED` means nothing left the account.
 *   Item statuses are the common transaction_enum; the docs name none that is
 *   specific to Venmo, so Kin's mapping in payoutOutcome applies unchanged.
 * - The header needs only `sender_batch_id`; an item that sets its own
 *   `recipient_type` overrides the header's.
 *
 * Where they disagree, and the reading Kin took (all UNVERIFIED: the sandbox refuses Venmo)
 * - Recipient type: the guide says Venmo accepts `PHONE`, `EMAIL` or
 *   `USER_HANDLE`. The OpenAPI `recipient_enum` lists only EMAIL, PHONE and
 *   PAYPAL_ID, while the item description adds USER_HANDLE ("User handle (or)
 *   Username associated with Venmo account"). Kin uses all three for Venmo.
 * - Phone format: the Venmo page's sample uses `999-999-9999` and its CSV
 *   `5551232368` (no country code); the guide uses `+15555550123` in the
 *   request and shows `15562941698` in a response. Kin sends E.164
 *   (`+1` and ten digits), the one form the schema's E.164 notes support.
 * - Handle format: only the guide gives an example, `@venmousername`, so Kin
 *   sends the handle with its `@`. Nothing says whether PayPal also accepts it
 *   without; the sandbox could not be made to say.
 * - `recipient_wallet` casing: the guide's prose says `Venmo`, the schema enum
 *   says `VENMO`. Kin sends the enum value.
 * - Sandbox: the schema says "The PayPal sandbox does not support the PHONE
 *   recipient type", while the guide's Venmo sample uses a phone number. In
 *   fact the sandbox supports no Venmo item of any recipient type (above). Negative
 *   testing (an `ERRPYO...` code in the note) is documented only for an EMAIL
 *   item, and did not reach the Venmo check.
 * - Confirming the three receiver forms needs an environment that supports
 *   Venmo payouts, which the public sandbox does not. Until then, a Venmo payout
 *   is the least-verified path in Kin's money flow.
 */

/** Where a payout lands: the recipient's PayPal wallet, or Venmo (US only). */
export const PAYOUT_WALLETS = ["PAYPAL", "VENMO"] as const;
export type PayoutWallet = (typeof PAYOUT_WALLETS)[number];

/** Venmo payouts are US only, so they are sent in this currency only. */
export const VENMO_CURRENCY = "USD";

/**
 * PayPal's payout item statuses (Payouts v1, `transaction_enum`). Only
 * `SUCCESS` means the recipient has the money.
 */
export const PAYOUT_ITEM_STATUSES = ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"] as const;
export type PayoutItemStatus = (typeof PAYOUT_ITEM_STATUSES)[number];

/** What a payout item's status means for Kin's execution (docs/architecture.md section 8.5). */
export type PayoutOutcome = "confirmed" | "waiting" | "failed";

export type NewPayout = {
  /** The execution's idempotency key. PayPal pays one batch ID at most once in 30 days. */
  readonly senderBatchId: string;
  /**
   * The recipient's PayPal email address. For Venmo, an email, a US mobile
   * number or an @handle (`payoutRecipient` says which is which).
   */
  readonly receiver: string;
  readonly amount: Money;
  /** What the recipient reads with the money. Venmo needs one. */
  readonly note: string;
  /** Where the money lands. PayPal when left out. */
  readonly wallet?: PayoutWallet;
};

export type PayoutItem = {
  readonly itemId: string;
  readonly status: PayoutItemStatus | "OTHER";
  readonly transactionId: string | null;
  readonly amount: Money;
  /** PayPal's fee for this item, once it has charged one. */
  readonly fee: Money | null;
  readonly senderItemId: string | null;
  /** The wallet PayPal says the item went to, when it says. */
  readonly wallet: PayoutWallet | null;
};

export type PayoutBatch = {
  readonly batchId: string;
  /** `DENIED`, `PENDING`, `PROCESSING`, `SUCCESS` or `CANCELED`. */
  readonly batchStatus: string;
  readonly senderBatchId: string | null;
  readonly items: readonly PayoutItem[];
};

export type PayoutRecipient = { readonly recipientType: "EMAIL" | "PHONE" | "USER_HANDLE"; readonly value: string };

/** Why Kin will not send a payout. Retrying cannot help: the payout itself must change. */
export type PayoutNotSendableReason = "invalid_receiver" | "venmo_usd_only" | "venmo_note_required";

/**
 * A payout that PayPal would refuse, or that Kin cannot be sure PayPal would
 * read as intended, stopped before anything is sent. It never carries the
 * receiver: that is personal data.
 */
export class PayoutNotSendableError extends Error {
  readonly retryable = false;
  readonly reason: PayoutNotSendableReason;

  constructor(reason: PayoutNotSendableReason) {
    super(`Payout not sent: ${reason}`);
    this.name = "PayoutNotSendableError";
    this.reason = reason;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The same pattern the database applies when a caregiver sets a Venmo handle (migration 0033).
const HANDLE = /^@[A-Za-z0-9_-]{3,30}$/;

/**
 * Which kind of address `receiver` is, and its value as PayPal wants it. A
 * PayPal wallet takes an email only. Venmo also takes a US mobile number (sent
 * as `+1` and ten digits, whatever punctuation it was written with) and an
 * @handle (sent with its `@`). See the notes above on what is unverified; the
 * sandbox accepts no Venmo item, so none of these forms has been confirmed.
 */
export function payoutRecipient(receiver: string, wallet: PayoutWallet): PayoutRecipient {
  const text = receiver.trim();
  if (EMAIL.test(text)) return { recipientType: "EMAIL", value: text };
  if (wallet === "VENMO") {
    if (HANDLE.test(text)) return { recipientType: "USER_HANDLE", value: text };
    const digits = usMobileDigits(text);
    if (digits !== null) return { recipientType: "PHONE", value: `+1${digits}` };
  }
  throw new PayoutNotSendableError("invalid_receiver");
}

// Ten digits after an optional leading 1, with only the usual punctuation around them.
function usMobileDigits(text: string): string | null {
  if (!/^\+?[\d\s().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
}

/** The one-item batch that pays an approved proposal. Throws `PayoutNotSendableError` before anything is built that PayPal would refuse. */
export function payoutBody(payout: NewPayout): string {
  const wallet = payout.wallet ?? "PAYPAL";
  const recipient = payoutRecipient(payout.receiver, wallet);
  if (wallet === "VENMO") {
    if (payout.amount.currency !== VENMO_CURRENCY) throw new PayoutNotSendableError("venmo_usd_only");
    if (payout.note.trim() === "") throw new PayoutNotSendableError("venmo_note_required");
  }
  const note = payout.note.slice(0, 1000);
  const amount = { currency: payout.amount.currency, value: decimalAmount(payout.amount) };
  return JSON.stringify({
    sender_batch_header: {
      sender_batch_id: payout.senderBatchId,
      recipient_type: recipient.recipientType,
      email_subject: "You have a payment from Kin",
      email_message: note,
    },
    items: [
      {
        recipient_type: recipient.recipientType,
        receiver: recipient.value,
        amount,
        note,
        sender_item_id: payout.senderBatchId,
        ...(wallet === "VENMO" ? { recipient_wallet: wallet, application_context: { social_feed_privacy: "PRIVATE" } } : {}),
      },
    ],
  });
}

/** The batch ID PayPal answered a new payout with. */
export function parsePayoutCreated(value: unknown): { readonly batchId: string } {
  const header = asRecord(asRecord(value, "payout").batch_header, "payout batch header");
  return { batchId: requiredText(header, "payout_batch_id") };
}

/** Reads a payout batch with its items, amounts in integer cents. */
export function parsePayoutBatch(value: unknown): PayoutBatch {
  const record = asRecord(value, "payout batch");
  const header = asRecord(record["batch_header"], "payout batch header");
  return {
    batchId: requiredText(header, "payout_batch_id"),
    batchStatus: requiredText(header, "batch_status"),
    senderBatchId: optionalText(optionalRecord(header["sender_batch_header"]), "sender_batch_id"),
    items: recordList(record["items"]).map(parseItem),
  };
}

/**
 * Where an item stands for Kin. Unclaimed money stays at PayPal until the
 * recipient claims it, and held money waits for PayPal, so both wait.
 */
export function payoutOutcome(status: PayoutItem["status"]): PayoutOutcome {
  switch (status) {
    case "SUCCESS":
      return "confirmed";
    case "PENDING":
    case "UNCLAIMED":
    case "ONHOLD":
    case "OTHER":
      return "waiting";
    case "FAILED":
    case "RETURNED":
    case "BLOCKED":
    case "REFUNDED":
    case "REVERSED":
      return "failed";
  }
}

function parseItem(item: JsonRecord): PayoutItem {
  const detail = asRecord(item["payout_item"], "payout item detail");
  const status = optionalText(item, "transaction_status");
  const fee = optionalRecord(item["payout_item_fee"]);
  return {
    itemId: requiredText(item, "payout_item_id"),
    status: PAYOUT_ITEM_STATUSES.find((each) => each === status) ?? "OTHER",
    transactionId: optionalText(item, "transaction_id"),
    amount: payoutMoney(asRecord(detail["amount"], "payout amount")),
    fee: fee === null ? null : payoutMoney(fee),
    senderItemId: optionalText(detail, "sender_item_id"),
    wallet: PAYOUT_WALLETS.find((each) => each === optionalText(detail, "recipient_wallet")?.toUpperCase()) ?? null,
  };
}

// Payouts write money as { currency, value }, unlike Orders' currency_code.
function payoutMoney(record: JsonRecord): Money {
  const currency = requiredText(record, "currency");
  try {
    return { cents: centsFromDecimal(requiredText(record, "value"), currency), currency };
  } catch {
    throw new PayPalShapeError("payout amount");
  }
}
