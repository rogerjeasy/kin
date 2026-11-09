import { MAX_WISHES_SAID_CHARS, ModelUnavailableError, draftWishes, type DraftedWish, type StructuredModel, type WishRecordNames } from "@kin/agent";
import { authorize, type BillingAccount, type CircleAction } from "@kin/auth";
import {
  WishError,
  addParentSubscription,
  asPerson,
  attestWishTrigger,
  confirmWish,
  dismissWishTrigger,
  isWishTrigger,
  readWishRecording,
  recordWish,
  storeWishRecording,
  withdrawWish,
  witnessWish,
  type CircleSnapshot,
  type Database,
  type WishReason,
} from "@kin/db";
import { InvalidDecimalError, WishRuleError, centsFromDecimal, checkWishDraft, type WishContext, type WishRule, type WishRuleReason } from "@kin/domain";
import { MAX_RECORDING_BYTES, SpeechUnavailableError, isSpeechLocale } from "@kin/speech";

import { spendUse, type RateLimiter } from "./model";
import type { SpeechServices } from "./speech";
import { wavFromPcm } from "./wav";

export type WishesContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  readonly accountTypes: BillingAccount;
  readonly model: StructuredModel | null;
  readonly services: SpeechServices | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};

export type WishFailure = WishReason | WishRuleReason | "model_unavailable" | "speech_unavailable" | "recording" | "unreadable" | "unavailable";
export type WishFailed = { readonly ok: false; readonly reason: WishFailure };
export type WishDrafts = { readonly ok: true; readonly wishes: readonly DraftedWish[] };
export type WishesResult = { readonly ok: true; readonly id?: string; readonly state?: string } | WishDrafts | WishFailed;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (reason: WishFailure): WishFailed => ({ ok: false, reason });

/**
 * The one request boundary for the parent's wishes. She asks Kin to read her
 * words back as rules (the model drafts, plain code checks every draft against
 * the record), keeps the ones she confirms, and withdraws them; the family
 * witnesses them; the family, and the caregiver for a hospital stay, say when
 * a trigger happened. Every write is an operation of the database run as the
 * person, which decides again. No model is asked anything at the moment a
 * wish applies.
 */
export async function runWishes(context: WishesContext, input: unknown): Promise<WishesResult> {
  const row = record(input);
  if (row === null || typeof row.operation !== "string") return fail("invalid");
  const circleId = context.circle.circle.id;
  const may = (action: CircleAction) => authorize({ role: context.circle.viewer.role, status: "active" }, action).allowed;
  try {
    switch (row.operation) {
      case "draft": {
        if (!may("wish.record")) return fail("refused");
        if (!keys(row, ["operation", "said", "locale"]) || typeof row.said !== "string" || typeof row.locale !== "string") return fail("invalid");
        return await draft(context, row.said, row.locale);
      }
      case "keep": {
        if (!may("wish.record")) return fail("refused");
        if (!keys(row, ["operation", "quote", "trigger", "rule", "recordingId", "wishKey", "method"])) return fail("invalid");
        const recordingId = optionalId(row.recordingId);
        const wishKey = optionalId(row.wishKey);
        if (recordingId === undefined || wishKey === undefined || typeof row.quote !== "string" || !isWishTrigger(row.trigger)) return fail("invalid");
        const rule = ruleOf(row.rule);
        if (rule === null) return fail("invalid");
        const checked = checkWishDraft({ quote: row.quote, trigger: row.trigger, rule }, wishContextOf(context.circle));
        const method = row.method === "voice" ? "voice" : "app";
        const id = await asPerson(context.db, context.userId, async (tx) => {
          const wishId = await recordWish(tx, { circleId, quote: checked.quote, trigger: checked.trigger, rule: checked.rule, recordingId, wishKey });
          await confirmWish(tx, { circleId, wishId, method });
          return wishId;
        });
        return { ok: true, id };
      }
      case "witness": {
        if (!may("wish.witness")) return fail("refused");
        const wishId = idIn(row, "wishId");
        if (wishId === null) return fail("invalid");
        const state = await asPerson(context.db, context.userId, (tx) => witnessWish(tx, { circleId, wishId }));
        return { ok: true, id: wishId, state };
      }
      case "withdraw": {
        if (!may("wish.record")) return fail("refused");
        const wishId = idIn(row, "wishId");
        if (wishId === null) return fail("invalid");
        await asPerson(context.db, context.userId, (tx) => withdrawWish(tx, { circleId, wishId }));
        return { ok: true, id: wishId };
      }
      case "attest": {
        if (!may("wish_trigger.attest")) return fail("refused");
        if (!keys(row, ["operation", "event", "stance"]) || (row.event !== "hospital" && row.event !== "care_home") || (row.stance !== "start" && row.stance !== "end")) return fail("invalid");
        const { event, stance } = row;
        const outcome = await asPerson(context.db, context.userId, (tx) => attestWishTrigger(tx, { circleId, event, stance }));
        return { ok: true, id: outcome.triggerId, state: outcome.state };
      }
      case "dismiss": {
        if (!may("wish_trigger.dismiss")) return fail("refused");
        const triggerId = idIn(row, "triggerId");
        if (triggerId === null) return fail("invalid");
        await asPerson(context.db, context.userId, (tx) => dismissWishTrigger(tx, { circleId, triggerId }));
        return { ok: true, id: triggerId };
      }
      case "subscription": {
        if (!may("parent_subscription.manage")) return fail("refused");
        if (!keys(row, ["operation", "name", "monthly", "paypalSubscriptionId"]) || typeof row.name !== "string" || typeof row.monthly !== "string") return fail("invalid");
        const paypal = row.paypalSubscriptionId === null || row.paypalSubscriptionId === "" ? null : typeof row.paypalSubscriptionId === "string" ? row.paypalSubscriptionId.trim() : undefined;
        const name = row.name.replace(/\s+/g, " ").trim();
        if (paypal === undefined || name === "" || name.length > 80) return fail("invalid");
        const monthlyCents = centsFromDecimal(row.monthly.trim(), context.circle.circle.currency);
        const id = await asPerson(context.db, context.userId, (tx) => addParentSubscription(tx, { circleId, name, monthlyCents, paypalSubscriptionId: paypal }));
        return { ok: true, id };
      }
      default:
        return fail("invalid");
    }
  } catch (error) {
    if (error instanceof WishError || error instanceof WishRuleError) return fail(error.reason);
    if (error instanceof InvalidDecimalError) return fail("invalid");
    throw error;
  }
}

/** Her words read back as draft rules. Nothing is stored. */
async function draft(context: WishesContext, said: string, locale: string): Promise<WishDrafts | WishFailed> {
  if (said.trim() === "" || said.length > MAX_WISHES_SAID_CHARS) return fail("unreadable");
  if (context.model === null) return fail("model_unavailable");
  if (!spendUse(context, context, (context.now ?? Date.now)())) return fail("busy");
  try {
    const result = await draftWishes(context.model, said, wishNamesOf(context.circle, locale));
    if (result.kind !== "drafts") return fail("unreadable");
    return { ok: true, wishes: result.wishes };
  } catch (error) {
    if (error instanceof ModelUnavailableError) return fail("model_unavailable");
    throw error;
  }
}

/**
 * Keeps her recording, in her own voice, and writes down what she said when
 * this deployment can hear speech. The recording is kept either way, so the
 * wish she then confirms can carry it.
 */
export async function keepRecording(context: WishesContext, recording: { readonly pcm: Uint8Array; readonly locale: string }): Promise<{ ok: true; recordingId: string; transcript: string | null } | WishFailed> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "wish.record").allowed) return fail("refused");
  const { pcm, locale } = recording;
  if (!isSpeechLocale(locale)) return fail("invalid");
  if (pcm.byteLength === 0 || pcm.byteLength > MAX_RECORDING_BYTES || pcm.byteLength % 2 !== 0) return fail("recording");
  if (!spendUse(context, context, (context.now ?? Date.now)())) return fail("busy");
  try {
    const recordingId = await asPerson(context.db, context.userId, (tx) => storeWishRecording(tx, { circleId: context.circle.circle.id, wav: wavFromPcm(pcm) }));
    if (context.services === null) return { ok: true, recordingId, transcript: null };
    try {
      return { ok: true, recordingId, transcript: (await context.services.transcriber({ pcm, locale })).trim().slice(0, MAX_WISHES_SAID_CHARS) };
    } catch (error) {
      if (error instanceof SpeechUnavailableError) return { ok: true, recordingId, transcript: null };
      throw error;
    }
  } catch (error) {
    if (error instanceof WishError) return fail(error.reason);
    throw error;
  }
}

/**
 * A wish's words, aloud: her own recording when she made one, or her words
 * read by Kin's voice, which every screen labels as Kin's and not hers. Only
 * the family, who may read her wishes, may hear them; the words are the
 * stored ones, never text sent in.
 */
export async function wishAudio(context: WishesContext, input: unknown): Promise<{ ok: true; audio: Uint8Array; contentType: string } | WishFailed> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "wish.view").allowed) return fail("refused");
  const row = record(input);
  if (row === null || !keys(row, ["wishId", "locale"]) || typeof row.locale !== "string") return fail("invalid");
  const wishId = typeof row.wishId === "string" && UUID.test(row.wishId) ? row.wishId : null;
  if (wishId === null) return fail("invalid");
  const locale = row.locale;
  const wish = context.circle.wishes.wishes.find((each) => each.id === wishId);
  if (wish === undefined) return fail("refused");
  if (wish.recordingId !== null) {
    const recordingId = wish.recordingId;
    const stored = await asPerson(context.db, context.userId, (tx) => readWishRecording(tx, { circleId: context.circle.circle.id, recordingId }));
    return stored === null ? fail("refused") : { ok: true, audio: stored.audio, contentType: stored.contentType };
  }
  if (context.services === null) return fail("speech_unavailable");
  if (!isSpeechLocale(locale)) return fail("invalid");
  if (!spendUse(context, context, (context.now ?? Date.now)())) return fail("busy");
  try {
    const spoken = await context.services.voice({ text: wish.quote, locale });
    return spoken === null ? fail("speech_unavailable") : { ok: true, audio: spoken.audio, contentType: spoken.contentType };
  } catch (error) {
    if (error instanceof SpeechUnavailableError) return fail("speech_unavailable");
    throw error;
  }
}

/** What a draft is checked against: the circle's own members, caregivers and subscriptions. */
export function wishContextOf(circle: CircleSnapshot): WishContext {
  return {
    members: circle.members.map((member) => ({ id: member.id, role: member.role, active: member.status === "active" })),
    caregiverPayeeIds: caregiversOf(circle).map((each) => each.payeeId),
    subscriptionIds: circle.wishes.subscriptions.map((each) => each.id),
  };
}

function caregiversOf(circle: CircleSnapshot): { payeeId: string; name: string }[] {
  return circle.payees.flatMap((payee) => (payee.payee.member?.role === "caregiver" && payee.caregiverRateCentsPerHour !== null ? [{ payeeId: payee.id, name: payee.name }] : []));
}

/** The names the model may see, each behind a slot; the IDs stay here. */
function wishNamesOf(circle: CircleSnapshot, locale: string): WishRecordNames {
  return {
    caregivers: caregiversOf(circle),
    members: circle.members
      .filter((member) => member.status === "active" && (member.role === "organizer" || member.role === "contributor"))
      .map((member) => ({ memberId: member.id, name: member.displayName, relationship: member.relationship })),
    subscriptions: circle.wishes.subscriptions.map((each) => ({ id: each.id, name: each.name })),
    currency: circle.circle.currency,
    locale,
    context: wishContextOf(circle),
  };
}

/** A rule as the browser sends it back, read into the rule's own shape; anything else is `null`. */
function ruleOf(value: unknown): WishRule | null {
  const row = record(value);
  if (row === null) return null;
  const ids = (list: unknown): string[] | null => (Array.isArray(list) && list.every((each) => typeof each === "string" && UUID.test(each)) ? (list as string[]) : null);
  switch (row.kind) {
    case "keep_paying":
      return keys(row, ["kind", "payeeId"]) && typeof row.payeeId === "string" && UUID.test(row.payeeId) ? { kind: "keep_paying", payeeId: row.payeeId } : null;
    case "pause_discretionary":
      return keys(row, ["kind"]) ? { kind: "pause_discretionary" } : null;
    case "suspend_subscriptions": {
      const subscriptionIds = ids(row.subscriptionIds);
      return keys(row, ["kind", "subscriptionIds"]) && subscriptionIds !== null ? { kind: "suspend_subscriptions", subscriptionIds } : null;
    }
    case "new_payee_approvals": {
      const approverMemberIds = ids(row.approverMemberIds);
      const cents = row.aboveCents;
      return keys(row, ["kind", "aboveCents", "approverMemberIds"]) && approverMemberIds !== null && typeof cents === "number" && Number.isSafeInteger(cents)
        ? { kind: "new_payee_approvals", aboveCents: cents, approverMemberIds }
        : null;
    }
    case "successor":
      return keys(row, ["kind", "memberId"]) && typeof row.memberId === "string" && UUID.test(row.memberId) ? { kind: "successor", memberId: row.memberId } : null;
    default:
      return null;
  }
}

/** `null` for none, the ID when it is one, `undefined` when it is neither. */
function optionalId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}
function idIn(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return keys(row, ["operation", key]) && typeof value === "string" && UUID.test(value) ? value : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function keys(row: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(row).every((key) => allowed.includes(key));
}
