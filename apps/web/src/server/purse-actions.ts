import { narrateWithProvenance, type StructuredModel } from "@kin/agent";
import { authorize, type BillingAccount, type CircleAction } from "@kin/auth";
import {
  PURSE_PAYEE_KINDS,
  PurseError,
  addPursePayee,
  answerPursePayment,
  asPerson,
  cancelPursePayment,
  proposePursePayment,
  readPurse,
  readPursePayees,
  readPursePayment,
  readPursePayments,
  readPurseSpendingAllowed,
  removePursePayee,
  setPurse,
  setPurseStatus,
  sharePursePayment,
  verifyPursePayee,
  type CircleSnapshot,
  type Database,
  type PurseReason,
} from "@kin/db";
import { InvalidDecimalError, MAX_PURSE_WORDS_CHARS, PURSE_CASH, PurseTermsError, accountBalance, centsFromDecimal, checkPurseTerms, decidePursePayment, purseReservedCents, type PurseRefusal } from "@kin/domain";

import { LANGUAGE_NAMES } from "@/components/dashboard/words/letter-words";
import { circleFormatters } from "@/content/circle/format";
import { getDictionary } from "@/i18n/dictionary";
import { isLocale, type Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { typedAmount } from "@/lib/typed-amount";

import { spendUse, type RateLimiter } from "./model";
import { paymentView, type PursePaymentView } from "./purse";
import { readPurseWords } from "./purse-reading";

export type PurseActionContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  /** Whose spending the model use is counted against. Without it, the model is not asked. */
  readonly accountTypes?: BillingAccount;
  /** Claude, when this deployment has it. It copies the payment out of her words and words the read-back; plain code decides. */
  readonly model?: StructuredModel | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};

export type PurseFailure = PurseReason | PurseRefusal | "no_purse" | "no_amount" | "no_payee" | "amount" | "terms" | "unavailable";

export type PurseResult =
  | { readonly ok: true; readonly payment?: PursePaymentView; readonly outcome?: string }
  | { readonly ok: false; readonly reason: PurseFailure; readonly availableCents?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
/** Stand-ins for the payee's name and the memo while Claude words the read-back: both are free text, so the model never sees them. */
const PAYEE_TOKEN = "«payee»";
const MEMO_TOKEN = "«memo»";

const fail = (reason: PurseFailure, availableCents?: number): PurseResult => (availableCents === undefined ? { ok: false, reason } : { ok: false, reason, availableCents });
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const onlyKeys = (row: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(row).every((key) => keys.includes(key));
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null);
const id = (value: unknown): string | null => (typeof value === "string" && UUID.test(value) ? value : null);

function allowed(context: PurseActionContext, action: CircleAction): boolean {
  return authorize({ role: context.circle.viewer.role, status: "active" }, action).allowed;
}

function nameOf(circle: CircleSnapshot): (memberId: string) => string {
  const names = new Map(circle.members.map((member) => [member.id, member.displayName]));
  return (memberId) => names.get(memberId) ?? "";
}

export type GiftAsk = { readonly words: string; readonly locale: Locale; readonly payee?: string; readonly amount?: string; readonly memo?: string | null };

/**
 * She asks Kin to pay someone from her Purse, in her own words (spoken or
 * typed), or as the fields Ask Kin's propose_gift tool was given. Plain code
 * finds the payee in her book, reads the amount and decides whether it goes,
 * waits or is refused; Kin then reads it back, and nothing is approved until
 * she answers. The read-back's amount passes the number guard, and the
 * payee's name and the memo never reach the model.
 */
export async function askPurse(context: PurseActionContext, ask: GiftAsk): Promise<PurseResult> {
  if (!allowed(context, "purse.spend")) return fail("refused");
  const { circle } = context;
  const circleId = circle.circle.id;
  const { currency } = circle.circle;
  const state = await asPerson(context.db, context.userId, async (tx) => ({
    purse: await readPurse(tx, circleId),
    payees: await readPursePayees(tx, circleId),
    payments: await readPursePayments(tx, circleId, 200),
    spendingAllowed: await readPurseSpendingAllowed(tx, circleId),
  }));
  if (state.purse === null) return fail("no_purse");
  const now = (context.now ?? Date.now)();
  const model = context.model ?? null;
  const mayUseModel = model !== null && context.accountTypes !== undefined && spendUse(context, { userId: context.userId, accountTypes: context.accountTypes }, now);
  const reading = ask.payee !== undefined && ask.amount !== undefined
    ? await readPurseWords(null, `${ask.payee} ${ask.amount}${ask.memo ? ` ${ask.memo}` : ""}`, state.payees, currency, ask.locale).then((read) => ({ ...read, payeeName: read.payee?.name ?? ask.payee ?? null, memo: ask.memo ?? null, cents: safeCents(ask.amount ?? "", currency) }))
    : await readPurseWords(mayUseModel ? model : null, ask.words, state.payees, currency, ask.locale);
  if (reading.payeeName === null) return fail("no_payee");
  if (reading.cents === null) return fail("no_amount");

  const balanceCents = accountBalance(circle.ledger, PURSE_CASH);
  const availableCents = Math.max(0, balanceCents - purseReservedCents(state.payments.map((payment) => ({ state: payment.state, cents: payment.cents, payeeVerified: payment.payeeId !== null }))));
  const payeeVerified = reading.payee !== null && reading.payee.verifiedAt !== null;
  const decision = decidePursePayment(
    { terms: state.purse, status: state.purse.status, availableCents, spendingAllowed: state.spendingAllowed },
    { cents: reading.cents, payeeVerified, words: [ask.words, reading.payeeName, reading.memo ?? ""].filter((each) => each !== ""), route: reading.route },
  );
  if (decision.outcome === "refused") return fail(decision.reason, decision.reason === "over_balance" ? availableCents : undefined);

  const held = decision.outcome === "hold";
  const readBack = await readBackOf(context, { locale: ask.locale, cents: reading.cents, payeeName: reading.payeeName, memo: reading.memo, held, mayUseModel });
  try {
    const proposed = await asPerson(context.db, context.userId, async (tx) => {
      const { id: paymentId } = await proposePursePayment(tx, {
        circleId,
        payeeId: payeeVerified && reading.payee !== null ? reading.payee.id : null,
        payeeName: reading.payeeName ?? "",
        cents: reading.cents ?? 0,
        memo: reading.memo,
        words: ask.words.slice(0, MAX_PURSE_WORDS_CHARS),
        route: reading.route,
        markers: decision.markers,
        holdReasons: held ? decision.reasons : [],
        readBack: readBack.text,
        readBackSource: readBack.source,
      });
      return readPursePayment(tx, circleId, paymentId);
    });
    if (proposed === null) return fail("unavailable");
    return { ok: true, payment: paymentView(proposed, nameOf(circle)) };
  } catch (error) {
    if (error instanceof PurseError) return fail(error.reason);
    throw error;
  }
}

function safeCents(amount: string, currency: string): number | null {
  try {
    const cents = centsFromDecimal(typedAmount(amount), currency);
    return cents > 0 ? cents : null;
  } catch (error) {
    if (error instanceof InvalidDecimalError) return null;
    throw error;
  }
}

/**
 * The sentence Kin reads back, from the record: Claude may word it warmly, but
 * a wording that changes the amount, or loses the payee or the memo, falls
 * back to the fixed sentence.
 */
async function readBackOf(context: PurseActionContext, input: { locale: Locale; cents: number; payeeName: string; memo: string | null; held: boolean; mayUseModel: boolean }): Promise<{ text: string; source: "model" | "template" }> {
  const dictionary = await getDictionary(input.locale);
  const copy = dictionary.dashboard.purse.readBack;
  const amount = circleFormatters(input.locale, context.circle).money(input.cents);
  const sentence = (payee: string, memo: string) => fill(input.held ? copy.hold : copy.pay, { payee, amount, memo: memo === "" ? "" : ` ${memo}` });
  const fixed = sentence(input.payeeName, input.memo ?? "");
  const tokened = sentence(PAYEE_TOKEN, input.memo === null ? "" : MEMO_TOKEN);
  const narration = await narrateWithProvenance(input.mayUseModel ? (context.model ?? null) : null, { figures: [amount], statement: tokened, language: LANGUAGE_NAMES[input.locale] }, tokened);
  const kept = narration.text.includes(PAYEE_TOKEN) && (input.memo === null || narration.text.includes(MEMO_TOKEN));
  if (narration.source !== "model" || !kept) return { text: fixed, source: "template" };
  return { text: narration.text.replaceAll(PAYEE_TOKEN, () => input.payeeName).replaceAll(MEMO_TOKEN, () => input.memo ?? ""), source: "model" };
}

/**
 * The one request boundary for the Purse. The browser sends words, decimals
 * and IDs only: who may do what is decided by `authorize` and again by the
 * database, which also holds every rule of the money core it can hold.
 */
export async function runPurse(context: PurseActionContext, input: unknown): Promise<PurseResult> {
  const row = record(input);
  if (row === null || typeof row["operation"] !== "string") return fail("invalid");
  const circleId = context.circle.circle.id;
  const as = <T>(work: Parameters<typeof asPerson<T>>[2]) => asPerson(context.db, context.userId, work);
  try {
    switch (row["operation"]) {
      case "ask": {
        const words = text(row["words"], MAX_PURSE_WORDS_CHARS);
        if (!onlyKeys(row, ["operation", "words", "locale"]) || words === null || typeof row["locale"] !== "string" || !isLocale(row["locale"])) return fail("invalid");
        return await askPurse(context, { words, locale: row["locale"] });
      }
      case "answer": {
        const paymentId = id(row["paymentId"]);
        const answer = row["answer"];
        const method = row["method"];
        const evidence = text(row["evidence"], 400);
        if (!onlyKeys(row, ["operation", "paymentId", "answer", "method", "evidence"]) || paymentId === null || evidence === null || (answer !== "yes" && answer !== "no" && answer !== "pressured") || (method !== "app" && method !== "voice")) return fail("invalid");
        if (!allowed(context, "purse.spend")) return fail("refused");
        return { ok: true, outcome: await as((tx) => answerPursePayment(tx, { circleId, paymentId, answer, method, evidence })) };
      }
      case "cancel": {
        const paymentId = id(row["paymentId"]);
        if (!onlyKeys(row, ["operation", "paymentId"]) || paymentId === null) return fail("invalid");
        if (!allowed(context, "purse.cancel")) return fail("refused");
        await as((tx) => cancelPursePayment(tx, { circleId, paymentId, pressured: false }));
        return { ok: true };
      }
      case "share": {
        const paymentId = id(row["paymentId"]);
        if (!onlyKeys(row, ["operation", "paymentId", "share"]) || paymentId === null || typeof row["share"] !== "boolean") return fail("invalid");
        if (!allowed(context, "purse.spend")) return fail("refused");
        const share = row["share"];
        await as((tx) => sharePursePayment(tx, { circleId, paymentId, share }));
        return { ok: true };
      }
      case "setup":
        return await setUp(context, row);
      case "status": {
        const status = row["status"];
        if (!onlyKeys(row, ["operation", "status"]) || (status !== "paused" && status !== "active")) return fail("invalid");
        if (!allowed(context, status === "paused" ? "purse.stop" : "purse.setup")) return fail("refused");
        await as((tx) => setPurseStatus(tx, circleId, status));
        return { ok: true };
      }
      case "add_payee": {
        const name = text(row["name"], 80);
        const relationship = text(row["relationship"], 80);
        const receiver = text(row["receiver"], 254);
        const kind = PURSE_PAYEE_KINDS.find((each) => each === row["kind"]);
        if (!onlyKeys(row, ["operation", "name", "relationship", "kind", "receiver"]) || name === null || relationship === null || receiver === null || kind === undefined || !EMAIL.test(receiver)) return fail("invalid");
        if (!allowed(context, "purse_payee.add")) return fail("refused");
        await as((tx) => addPursePayee(tx, { circleId, name, relationship, kind, paypalReceiver: receiver }));
        return { ok: true };
      }
      case "verify_payee":
      case "remove_payee": {
        const payeeId = id(row["payeeId"]);
        if (!onlyKeys(row, ["operation", "payeeId"]) || payeeId === null) return fail("invalid");
        const verify = row["operation"] === "verify_payee";
        if (!allowed(context, verify ? "purse_payee.verify" : "purse_payee.add")) return fail("refused");
        await as((tx) => (verify ? verifyPursePayee(tx, circleId, payeeId) : removePursePayee(tx, circleId, payeeId)));
        return { ok: true };
      }
      default:
        return fail("invalid");
    }
  } catch (error) {
    if (error instanceof PurseError) return fail(error.reason);
    throw error;
  }
}

/** The organizer sets the weekly amount, the ceiling and the cap, checked by the money core and again by the database. */
async function setUp(context: PurseActionContext, row: Record<string, unknown>): Promise<PurseResult> {
  if (!onlyKeys(row, ["operation", "weekly", "ceiling", "cap"])) return fail("invalid");
  if (!allowed(context, "purse.setup")) return fail("refused");
  const { currency } = context.circle.circle;
  const amounts = [row["weekly"], row["ceiling"], row["cap"]].map((value) => (typeof value === "string" && value.length <= 16 ? safeCents(value, currency) : null));
  const [weeklyCents, ceilingCents, perPaymentCents] = amounts;
  if (weeklyCents == null || ceilingCents == null || perPaymentCents == null) return fail("amount");
  const agreementCeiling = context.circle.agreement?.approvals.ceilingCents;
  if (agreementCeiling === undefined) return fail("above_agreement");
  try {
    checkPurseTerms({ weeklyCents, ceilingCents, perPaymentCents }, agreementCeiling);
  } catch (error) {
    if (error instanceof PurseTermsError) return fail(error.reason === "above_agreement_ceiling" ? "above_agreement" : "terms");
    throw error;
  }
  await asPerson(context.db, context.userId, (tx) => setPurse(tx, { circleId: context.circle.circle.id, weeklyCents, ceilingCents, perPaymentCents }));
  return { ok: true };
}
