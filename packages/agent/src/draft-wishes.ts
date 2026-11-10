import { MAX_WISH_CHARS, WishRuleError, accountCents, checkWishDraft, cleanQuote, type WishContext, type WishDraft, type WishRule, type WishRuleReason, type WishTrigger } from "@kin/domain";

import { ModelUnavailableError, type StructuredModel } from "./structured-model.ts";
import { MAX_WISH_DRAFTS, WISH_DRAFT_KINDS, WISH_SCHEMA, wishSystemPrompt, wishUserMessage, type WishNames } from "./wish-prompt.ts";

/** The longest a parent may say at once for Kin to draft from: a few wishes. */
export const MAX_WISHES_SAID_CHARS = 2_000;

/** What the record holds that a wish may name, with the circle's own IDs. Only these reach a draft. */
export type WishRecordNames = {
  readonly caregivers: readonly { readonly payeeId: string; readonly name: string }[];
  /** The family members who share the cost: the only ones a wish may name as approvers or successor. */
  readonly members: readonly { readonly memberId: string; readonly name: string; readonly relationship: string | null }[];
  readonly subscriptions: readonly { readonly id: string; readonly name: string }[];
  readonly currency: string;
  readonly locale: string;
  /** What `checkWishDraft` checks each draft against. */
  readonly context: WishContext;
};

/** Why a wish is kept as words and not drafted: the model said so, it was not her words, or the record cannot hold it. */
export type FlagReason = "not_a_rule" | "not_her_words" | "unknown_slot" | WishRuleReason;

export type DraftedWish =
  | { readonly kind: "draft"; readonly draft: WishDraft }
  | { readonly kind: "flagged"; readonly quote: string; readonly reason: FlagReason };

export type DraftWishesResult = { readonly kind: "drafts"; readonly wishes: readonly DraftedWish[] } | { readonly kind: "refused" } | { readonly kind: "unreadable" };

const normalize = (text: string): string => text.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/**
 * Helps the parent put what she said into draft rules. The model only proposes
 * a kind and slots for each wish; plain code puts the record's own IDs in, reads
 * any amount from that wish's own quote, keeps a wish only if its quote is found in what
 * she said, and checks every draft against the record. Anything else is kept
 * as words and flagged, so a wish is never guessed into a rule. Nothing is
 * stored here: she hears each draft read back and confirms it.
 */
export async function draftWishes(model: StructuredModel, said: string, record: WishRecordNames): Promise<DraftWishesResult> {
  const text = said.trim();
  if (text === "" || text.length > MAX_WISHES_SAID_CHARS) return { kind: "unreadable" };
  const slots = slotsOf(record);
  const reply = await model({ system: wishSystemPrompt(), user: wishUserMessage(text, slots.names), schema: WISH_SCHEMA });
  if (reply.kind === "refused") return { kind: "refused" };
  if (reply.kind === "cut_off") return { kind: "unreadable" };
  let value: unknown;
  try {
    value = JSON.parse(reply.text);
  } catch (error) {
    throw new ModelUnavailableError("The model's answer was not JSON", { cause: error, kind: "unusable" });
  }
  const wishes = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)["wishes"] : null;
  if (!Array.isArray(wishes)) throw new ModelUnavailableError("The model's answer did not follow the schema", { kind: "unusable" });
  const words = normalize(text);
  return { kind: "drafts", wishes: wishes.slice(0, MAX_WISH_DRAFTS).flatMap((each) => drafted(each, words, slots, record)) };
}

type Slots = {
  readonly names: WishNames;
  readonly caregiver: ReadonlyMap<string, string>;
  readonly member: ReadonlyMap<string, string>;
  readonly subscription: ReadonlyMap<string, string>;
};

function slotsOf(record: WishRecordNames): Slots {
  const caregivers = record.caregivers.map((each, index) => ({ slot: `c${index + 1}`, ...each }));
  const members = record.members.map((each, index) => ({ slot: `m${index + 1}`, ...each }));
  const subscriptions = record.subscriptions.map((each, index) => ({ slot: `s${index + 1}`, ...each }));
  return {
    names: {
      caregivers: caregivers.map(({ slot, name }) => ({ slot, name })),
      members: members.map(({ slot, name, relationship }) => ({ slot, name, relationship })),
      subscriptions: subscriptions.map(({ slot, name }) => ({ slot, name })),
    },
    caregiver: new Map(caregivers.map((each) => [each.slot, each.payeeId])),
    member: new Map(members.map((each) => [each.slot, each.memberId])),
    subscription: new Map(subscriptions.map((each) => [each.slot, each.id])),
  };
}

class UnknownSlot extends Error {}

/** Every figure written in digits, whole: "2,000" is one figure, and "200" is never found inside "2000". */
const FIGURES = /\p{Nd}+(?:[.,\u00a0\u202f ]\p{Nd}+)*/gu;

/**
 * The amount in a wish's own quote, as cents: its one figure in digits, or one
 * written in words when that makes exactly one number. `null` when it has none,
 * or more than one, so a wish never takes an amount it did not say.
 */
export function amountInQuote(quote: string, currency: string, locale: string): number | null {
  if ((quote.match(FIGURES) ?? []).length > 1) return null;
  return accountCents(quote, currency, locale);
}

function drafted(raw: unknown, words: string, slots: Slots, record: WishRecordNames): DraftedWish[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const row = raw as Record<string, unknown>;
  const quote = typeof row["quote"] === "string" ? cleanQuote(row["quote"]) : null;
  if (quote === null) return [];
  const flag = (reason: FlagReason): DraftedWish[] => [{ kind: "flagged", quote: quote.slice(0, MAX_WISH_CHARS), reason }];
  if (!words.includes(normalize(quote))) return flag("not_her_words");
  const kind = WISH_DRAFT_KINDS.find((each) => each === row["kind"]);
  if (kind === undefined || kind === "not_a_rule") return flag("not_a_rule");
  const trigger: WishTrigger = row["trigger"] === "hospital" || row["trigger"] === "care_home" ? row["trigger"] : "either";
  let rule: WishRule;
  try {
    rule = ruleOf(kind, row, quote, slots, record);
  } catch (error) {
    if (error instanceof UnknownSlot) return flag("unknown_slot");
    if (error instanceof WishRuleError) return flag(error.reason);
    throw error;
  }
  try {
    return [{ kind: "draft", draft: checkWishDraft({ quote, trigger, rule }, record.context) }];
  } catch (error) {
    if (error instanceof WishRuleError) return flag(error.reason);
    throw error;
  }
}

function ruleOf(kind: Exclude<(typeof WISH_DRAFT_KINDS)[number], "not_a_rule">, row: Record<string, unknown>, quote: string, slots: Slots, record: WishRecordNames): WishRule {
  const one = (map: ReadonlyMap<string, string>, value: unknown): string => {
    const id = typeof value === "string" ? map.get(value) : undefined;
    if (id === undefined) throw new UnknownSlot();
    return id;
  };
  const many = (map: ReadonlyMap<string, string>, value: unknown): string[] => (Array.isArray(value) ? value.map((each) => one(map, each)) : []);
  switch (kind) {
    case "keep_paying":
      return { kind, payeeId: one(slots.caregiver, row["payee"]) };
    case "pause_discretionary":
      return { kind };
    case "suspend_subscriptions":
      return { kind, subscriptionIds: many(slots.subscription, row["subscriptions"]) };
    case "successor":
      return { kind, memberId: one(slots.member, row["successor"]) };
    case "new_payee_approvals": {
      // The amount is read by code from this wish's own words. The model gives none, so it can neither make one up nor borrow one from elsewhere.
      const cents = amountInQuote(quote, record.currency, record.locale);
      if (cents === null) throw new WishRuleError("amount");
      return { kind, aboveCents: cents, approverMemberIds: many(slots.member, row["approvers"]) };
    }
  }
}
