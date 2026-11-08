import { formatMoney, type Answers, type CallVerdict, type ClaimReason } from "@kin/domain";

import { fillTemplate as fill } from "./fill-template.ts";
import { OFFICE_WORDS, type AlertWords, type OfficeLocale } from "./office-words.ts";

const MAX_ALERT_CHARS = 600;
const MAX_CLAIM_CHARS = 500;

const TEMPLATE = {
  open_bill: "openBill",
  already_paid: "alreadyPaid",
  unknown_payee: "unknownPayee",
  amount_differs: "amountDiffers",
  no_amount: "noAmount",
} as const satisfies Record<ClaimReason, keyof AlertWords>;

const RIGHT_TO_LEFT: ReadonlySet<OfficeLocale> = new Set(["ar", "he"]);

/** Digits and neutral marks drift in a right-to-left sentence, so each amount is isolated there, as the dashboard does. */
const isolated = (locale: OfficeLocale, text: string): string => (RIGHT_TO_LEFT.has(locale) ? `⁨${text}⁩` : text);

export type FamilyAlert = {
  /** The two lines the family is told, filled from the record. */
  readonly spoken: string;
  /** What the caller claimed, as one line for the claim check. */
  readonly claim: string;
};

/**
 * What the family is told about a call, and the claim check's one-line claim,
 * worded from fixed sentences with the figures of the record: the amount the
 * caller asked for, and the payment on record. No model words it. The web
 * app's simulator says the same things through its dictionaries, and a test
 * holds the two equal.
 */
export function familyAlert(locale: OfficeLocale, currency: string, verdict: CallVerdict, answers: Answers): FamilyAlert {
  const words = OFFICE_WORDS[locale].alert;
  const intlLocale = `${locale}-u-nu-latn`;
  const money = (cents: number): string => isolated(locale, formatMoney({ cents, currency }, intlLocale));
  const day = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" });
  const payee = verdict.claimedPayee !== "" ? verdict.claimedPayee : (answers.caller ?? words.unknownCaller);
  const { lastPayment } = verdict.result;
  const base = fill(words[TEMPLATE[verdict.result.reason]], {
    payee,
    claimed: verdict.claimedCents === null ? words.someMoney : money(verdict.claimedCents),
    paid: lastPayment === null ? "" : money(lastPayment.cents),
    paidDay: lastPayment === null ? "" : day.format(new Date(`${lastPayment.day}T00:00:00Z`)),
  });
  const spoken = (verdict.pressure.length === 0 ? base : `${base} ${words.pressureNote}`).slice(0, MAX_ALERT_CHARS);
  return { spoken, claim: `${payee}: ${answers.purpose ?? words.noPurpose}`.slice(0, MAX_CLAIM_CHARS) };
}
