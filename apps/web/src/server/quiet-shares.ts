import { MAX_OFFER_MESSAGES, MAX_OFFER_MESSAGE_CHARS, ModelUnavailableError, SHIFT_LANGUAGE_NAMES, readOffer, type DraftOffer, type StructuredModel } from "@kin/agent";
import { authorize, type CircleAction } from "@kin/auth";
import {
  QuietShareError,
  acceptMyQuietSharePart,
  asPerson,
  raiseQuietShare,
  readQuietShares,
  recordMyQuietShareAction,
  sealMyOffer,
  spreadQuietShare,
  takeDemoSeat,
  takeQuietShareGap,
  withdrawQuietShare,
  type CircleSnapshot,
  type Database,
  type OfferTerms,
  type QuietShareReason,
  type QuietShareRecord,
  type Transaction,
} from "@kin/db";
import {
  InvalidDecimalError,
  MAX_ASK_CENTS,
  MAX_ASK_TITLE,
  MAX_OFFER_SEALS,
  QUIET_PART_METHODS,
  QUIET_SHARE_KINDS,
  SealedOfferError,
  centsFromDecimal,
  checkSealedOffer,
  decimalAmount,
  isMonth,
  limitsCanBeDeduced,
  offersAreOpen,
  partMethods,
  type CircleRole,
  type QuietPartMethod,
  type QuietShareKind,
} from "@kin/domain";
import { PayPalError, type PayPalPool } from "@kin/paypal";

import type { Locale } from "@/i18n/locales";

/**
 * The one request boundary for quiet shares (docs/architecture.md decision
 * 92). A person's words go to their own agent and come back as a draft only
 * they see; the server never keeps them. A confirmed offer is sealed by the
 * database, which alone reads offers to mediate. Every figure a screen shows
 * comes from the person's own rows or the family's total.
 */

export type QuietContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot };

/** One ask as one person sees it: the family's progress, and their own offer and part. */
export type AskView = QuietShareRecord & {
  /** When a limit can be worked out: by the other of two, or by the others comparing their parts when the offers fall short. */
  readonly privacyCaveat: "pair" | "comparing" | null;
  /** How the person may pay their part, once there is one. */
  readonly methods: readonly QuietPartMethod[];
  readonly sealsLeft: number;
  readonly offersOpen: boolean;
};

/** A person's view in the demo's family layout: one sharer's own screen. */
export type FamilySeat = { readonly memberId: string; readonly name: string; readonly portrait: string | null; readonly role: CircleRole; readonly asks: readonly AskView[] };

export type QuietFailure = QuietShareReason | "unavailable" | "unreadable" | "paypal" | "limit";
export type QuietResult = { readonly ok: true; readonly state?: string; readonly id?: string; readonly approvalUrl?: string | null } | { readonly ok: false; readonly reason: QuietFailure };

/** The draft as the confirm form edits it: plain decimals and months, nothing worked out by the browser. */
export type DraftForm = { readonly monthly: string; readonly stepUp: string; readonly stepUpMonth: string; readonly earliestMonth: string; readonly careTrips: string; readonly careHours: string };
export type WordsResult = { readonly ok: true; readonly draft: DraftForm; readonly reply: string | null; readonly heardAmount: boolean } | { readonly ok: false; readonly reason: QuietFailure };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const view = (record: QuietShareRecord): AskView => ({
  ...record,
  privacyCaveat: limitsCanBeDeduced(record.askedCount, record.state),
  methods: record.myPart === null ? [] : partMethods(record.kind, record.myPart),
  sealsLeft: Math.max(0, MAX_OFFER_SEALS - (record.myOffer?.seals ?? 0)),
  offersOpen: offersAreOpen(record.state),
});

const readViews = (tx: Transaction, circleId: string, memberId: string) => readQuietShares(tx, { circleId, memberId }).then((records) => records.map(view));

/** The asks the viewer may see, each with their own offer and part. Empty for a role that does not see them. */
export async function quietShareViews(context: QuietContext): Promise<AskView[]> {
  if (!mayAct(context.circle, context.circle.viewer.memberId, "quiet_share.view")) return [];
  const { circle } = context;
  return asPerson(context.db, context.userId, (tx) => readViews(tx, circle.circle.id, circle.viewer.memberId));
}

/**
 * The demo's family layout: each sharer's own screen side by side. Each is
 * read in that person's seat, so row-level security returns exactly what
 * their own phone would show and nothing of the others'; the visitor's seat
 * is taken back before the transaction ends. A real circle has none.
 */
export async function familySeats(context: QuietContext): Promise<FamilySeat[] | null> {
  const { circle } = context;
  if (!circle.circle.demo || circle.agreement === null) return null;
  const sharers = circle.agreement.shares.flatMap((share) => circle.members.filter((member) => member.id === share.memberId));
  return asPerson(context.db, context.userId, async (tx) => {
    const seats: FamilySeat[] = [];
    for (const member of sharers) {
      await takeDemoSeat(tx, circle.circle.id, member.id);
      seats.push({ memberId: member.id, name: member.displayName, portrait: member.portrait, role: member.role, asks: await readViews(tx, circle.circle.id, member.id) });
    }
    await takeDemoSeat(tx, circle.circle.id, circle.viewer.memberId);
    return seats;
  });
}

/** Runs `work` in the viewer's own seat, or, in a demo circle, in another persona's seat that the visitor plays. */
async function inSeat<T>(context: QuietContext, seat: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const { circle } = context;
  if (seat === circle.viewer.memberId) return asPerson(context.db, context.userId, work);
  return asPerson(context.db, context.userId, async (tx) => {
    await takeDemoSeat(tx, circle.circle.id, seat);
    const result = await work(tx);
    await takeDemoSeat(tx, circle.circle.id, circle.viewer.memberId);
    return result;
  });
}

/** The seat a request acts in: the viewer's own, or, in a demo circle only, another persona's. `null` when refused. */
function seatOf(circle: CircleSnapshot, row: Record<string, unknown>): string | null {
  if (row.seat === undefined) return circle.viewer.memberId;
  if (typeof row.seat !== "string" || !UUID.test(row.seat) || !circle.circle.demo) return null;
  return circle.members.some((member) => member.id === row.seat) ? row.seat : null;
}

function mayAct(circle: CircleSnapshot, memberId: string, action: CircleAction): boolean {
  const member = circle.members.find((each) => each.id === memberId);
  return member !== undefined && authorize({ role: member.role, status: "active" }, action).allowed;
}

export type QuietServices = { readonly pool: PayPalPool | null; readonly returnUrl: string };

/** Every change a person makes to quiet shares: raise, seal, spread, take the gap, accept a part, prepare its PayPal action, withdraw. */
export async function runQuietShare(context: QuietContext, services: QuietServices, input: unknown): Promise<QuietResult> {
  const row = record(input);
  if (row === null) return refusal("invalid");
  const seat = seatOf(context.circle, row);
  if (seat === null) return refusal("refused");
  const circleId = context.circle.circle.id;
  try {
    switch (row.operation) {
      case "raise": {
        if (!mayAct(context.circle, seat, "quiet_share.raise")) return refusal("refused");
        if (!keys(row, ["operation", "title", "kind", "amount", "seat"])) return refusal("invalid");
        const { title, kind, amount } = row;
        if (typeof title !== "string" || title.trim() === "" || title.length > MAX_ASK_TITLE || typeof amount !== "string" || !QUIET_SHARE_KINDS.includes(kind as QuietShareKind)) return refusal("invalid");
        const costCents = centsFromDecimal(amount.trim(), context.circle.circle.currency);
        if (costCents <= 0 || costCents > MAX_ASK_CENTS) return refusal("invalid");
        const id = await inSeat(context, seat, (tx) => raiseQuietShare(tx, { circleId, title: title.trim(), kind: kind as QuietShareKind, costCents, billId: null }));
        return { ok: true, id };
      }
      case "seal": {
        if (!mayAct(context.circle, seat, "quiet_share.offer")) return refusal("refused");
        const askId = askOf(row);
        if (askId === null || !keys(row, ["operation", "askId", "offer", "seat"])) return refusal("invalid");
        const ask = await inSeat(context, seat, (tx) => readQuietShares(tx, { circleId, memberId: seat })).then((all) => all.find((each) => each.id === askId));
        if (ask === undefined) return refusal("refused");
        const offer = offerFrom(row.offer, ask.startMonth, context.circle.circle.currency);
        if (offer === null) return refusal("invalid");
        const state = await inSeat(context, seat, (tx) => sealMyOffer(tx, { circleId, askId, offer }));
        return { ok: true, state };
      }
      case "spread":
      case "take_gap":
      case "withdraw": {
        const askId = askOf(row);
        if (askId === null || !keys(row, ["operation", "askId", "seat"])) return refusal("invalid");
        if (!mayAct(context.circle, seat, row.operation === "take_gap" ? "quiet_share.offer" : "quiet_share.raise")) return refusal("refused");
        if (row.operation === "withdraw") {
          await inSeat(context, seat, (tx) => withdrawQuietShare(tx, { circleId, askId }));
          return { ok: true };
        }
        const state = await inSeat(context, seat, (tx) => (row.operation === "spread" ? spreadQuietShare(tx, { circleId, askId }) : takeQuietShareGap(tx, { circleId, askId })));
        return { ok: true, state };
      }
      case "accept": {
        if (!mayAct(context.circle, seat, "quiet_share.offer")) return refusal("refused");
        const askId = askOf(row);
        const method = QUIET_PART_METHODS.find((each) => each === row.method);
        if (askId === null || method === undefined || !keys(row, ["operation", "askId", "method", "seat"])) return refusal("invalid");
        const state = await inSeat(context, seat, (tx) => acceptMyQuietSharePart(tx, { circleId, askId, method }));
        return { ok: true, state };
      }
      case "prepare":
        return await prepare(context, services, row, seat);
      default:
        return refusal("invalid");
    }
  } catch (error) {
    if (error instanceof QuietShareError) return refusal(error.reason);
    if (error instanceof SealedOfferError || error instanceof InvalidDecimalError) return refusal("invalid");
    if (error instanceof PayPalError) return refusal("paypal");
    throw error;
  }
}

/**
 * Prepares the PayPal action for the person's own part of an agreed monthly
 * plan in a real circle: their live monthly share's subscription is revised
 * to its amount plus their part, and PayPal returns the page where they
 * approve the new price. Nothing is charged until they do. A demo circle's
 * actions are simulated and were prepared when the plan was agreed.
 */
async function prepare(context: QuietContext, services: QuietServices, row: Record<string, unknown>, seat: string): Promise<QuietResult> {
  if (!mayAct(context.circle, seat, "quiet_share.offer") || seat !== context.circle.viewer.memberId) return refusal("refused");
  const askId = askOf(row);
  if (askId === null || !keys(row, ["operation", "askId"])) return refusal("invalid");
  const { circle } = context;
  const ask = (await quietShareViews(context)).find((each) => each.id === askId);
  const part = ask?.myPart;
  if (ask === undefined || part == null || ask.state !== "agreed" || ask.simulated || part.method !== "monthly_share") return refusal("closed");
  if (part.approvalUrl !== null) return { ok: true, approvalUrl: part.approvalUrl };
  const share = circle.monthlyShares.find((each) => each.memberId === circle.viewer.memberId && (each.state === "active" || each.state === "paused") && each.paypalSubscriptionId !== null);
  if (share === undefined || share.paypalSubscriptionId === null) return refusal("closed");
  if (services.pool === null) return refusal("unavailable");
  const amount = { cents: share.cents + (part.perMonth[0] ?? 0), currency: circle.circle.currency };
  const revised = await services.pool.reviseSubscription(share.paypalSubscriptionId, amount, services.returnUrl, `kin-quiet-revise-${askId}-${circle.viewer.memberId}`);
  await asPerson(context.db, context.userId, (tx) => recordMyQuietShareAction(tx, { circleId: circle.circle.id, askId, paypalRef: share.paypalSubscriptionId ?? "", approvalUrl: revised.approvalUrl }));
  return { ok: true, approvalUrl: revised.approvalUrl };
}

/**
 * One turn of the person's private conversation with their own agent. Only
 * this person's words are sent, once; nothing is stored. Without a model the
 * person fills the offer in themselves.
 */
export async function readMyWords(context: QuietContext, model: StructuredModel | null, input: unknown, locale: Locale, spend: () => boolean): Promise<WordsResult> {
  const row = record(input);
  if (row === null || !keys(row, ["operation", "askId", "messages", "seat", "locale"])) return { ok: false, reason: "invalid" };
  const seat = seatOf(context.circle, row);
  if (seat === null || !mayAct(context.circle, seat, "quiet_share.offer")) return { ok: false, reason: "refused" };
  const messages = row.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_OFFER_MESSAGES || messages.some((each) => typeof each !== "string" || each.length > MAX_OFFER_MESSAGE_CHARS)) return { ok: false, reason: "invalid" };
  const askId = askOf(row);
  if (askId === null) return { ok: false, reason: "invalid" };
  const ask = await inSeat(context, seat, (tx) => readQuietShares(tx, { circleId: context.circle.circle.id, memberId: seat })).then((all) => all.find((each) => each.id === askId));
  if (ask === undefined || !ask.iAmAsked || !offersAreOpen(ask.state)) return { ok: false, reason: "closed" };
  if (model === null) return { ok: false, reason: "unavailable" };
  // The model is asked only while this person and this server still have a use left.
  if (!spend()) return { ok: false, reason: "limit" };
  try {
    const result = await readOffer(model, messages as string[], { startMonth: ask.startMonth, currency: context.circle.circle.currency, language: SHIFT_LANGUAGE_NAMES[locale] });
    if (result.kind !== "draft") return { ok: false, reason: "unreadable" };
    return { ok: true, draft: formOf(result.draft, context.circle.circle.currency), reply: result.reply, heardAmount: result.draft.monthlyCents !== null };
  } catch (error) {
    if (error instanceof ModelUnavailableError) return { ok: false, reason: "unavailable" };
    throw error;
  }
}

/** A draft as the confirm form shows it, in plain decimals: nothing worked out in the browser. */
function formOf(draft: DraftOffer, currency: string): DraftForm {
  const hundredths = Math.round((draft.careMinutes * 100) / 60);
  return {
    monthly: draft.monthlyCents === null ? "" : decimalAmount({ cents: draft.monthlyCents, currency }),
    stepUp: draft.stepUp === null ? "" : decimalAmount({ cents: draft.stepUp.cents, currency }),
    stepUpMonth: draft.stepUp?.fromMonth ?? "",
    earliestMonth: draft.earliestMonth ?? "",
    careTrips: draft.careTrips === 0 ? "" : String(draft.careTrips),
    careHours: draft.careMinutes === 0 ? "" : decimalAmount({ cents: hundredths, currency: "USD" }).replace(/\.00$/u, ""),
  };
}

/** The confirmed offer from the form, read digit by digit and checked by the domain's rules. `null` when its shape is not the form's. */
function offerFrom(value: unknown, startMonth: string, currency: string): OfferTerms | null {
  const form = record(value);
  if (form === null || !keys(form, ["monthly", "stepUp", "stepUpMonth", "earliestMonth", "careTrips", "careHours"])) return null;
  const fields: Partial<Record<keyof DraftForm, string>> = {};
  for (const key of ["monthly", "stepUp", "stepUpMonth", "earliestMonth", "careTrips", "careHours"] as const) {
    const field = form[key];
    if (field !== undefined && (typeof field !== "string" || field.length > 16)) return null;
    fields[key] = typeof field === "string" ? field.trim() : "";
  }
  const { monthly = "", stepUp = "", stepUpMonth = "", earliestMonth = "", careTrips = "", careHours = "" } = fields;
  if ((stepUp === "") !== (stepUpMonth === "") || (stepUpMonth !== "" && !isMonth(stepUpMonth)) || (earliestMonth !== "" && !isMonth(earliestMonth))) return null;
  if (careTrips !== "" && !/^\d{1,2}$/u.test(careTrips)) return null;
  // Hours are read as hundredths, from their digits, so 1.5 hours is exactly 90 minutes.
  const hoursHundredths = careHours === "" ? 0 : centsFromDecimal(careHours, "USD");
  const terms = checkSealedOffer(
    {
      memberId: "self",
      monthlyCents: monthly === "" ? 0 : centsFromDecimal(monthly, currency),
      stepUp: stepUp === "" ? null : { cents: centsFromDecimal(stepUp, currency), fromMonth: stepUpMonth },
      careTrips: careTrips === "" ? 0 : Number(careTrips),
      careMinutes: Math.round((hoursHundredths * 60) / 100),
      earliestMonth: earliestMonth === "" ? null : earliestMonth,
      takesShortfall: false,
    },
    startMonth,
  );
  return { monthlyCents: terms.monthlyCents, stepUp: terms.stepUp, careTrips: terms.careTrips, careMinutes: terms.careMinutes, earliestMonth: terms.earliestMonth };
}

const askOf = (row: Record<string, unknown>): string | null => (typeof row.askId === "string" && UUID.test(row.askId) ? row.askId : null);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
function refusal(reason: QuietFailure): QuietResult {
  return { ok: false, reason };
}
