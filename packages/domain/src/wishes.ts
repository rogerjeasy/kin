/**
 * The parent's wishes: while she can decide, she says what should happen to
 * her money on the day she cannot, and Kin carries it out in her own words.
 *
 * A wish is her sentence, kept as she said it, beside a rule that is data, not
 * code: when it applies (a trigger), and what it does (an action from a short,
 * closed list). The model may help turn her sentence into a draft rule; she
 * confirms what Kin reads back, two family members witness it, and from then
 * on only plain code here reads it. Nothing in this file guesses capacity,
 * reads her voice, or interprets a wish at the moment it applies: a trigger is
 * attested by people (`wish-trigger.ts`), and its effects follow from the rule
 * as written.
 *
 * A wish complements an advance directive and a power of attorney. It does not
 * replace them, and the screens say so.
 */
import { assertCents } from "./money.ts";
import type { CircleRole } from "./roles.ts";

// ---------------------------------------------------------------------------
// The rules a wish can hold
// ---------------------------------------------------------------------------

/** What a person attests happened: she went into hospital, or moved into a care home. */
export const TRIGGER_EVENTS = ["hospital", "care_home"] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** When a wish applies: on one of the events, or on either. */
export const WISH_TRIGGERS = ["hospital", "care_home", "either"] as const;
export type WishTrigger = (typeof WISH_TRIGGERS)[number];

/** The actions a wish can take. Anything she says that is none of these is kept as words and flagged, never guessed into a rule. */
export const WISH_RULE_KINDS = ["keep_paying", "pause_discretionary", "suspend_subscriptions", "new_payee_approvals", "successor"] as const;
export type WishRuleKind = (typeof WISH_RULE_KINDS)[number];

export type WishRule =
  /** "Always keep paying Amara, even if I'm in hospital": that caregiver's pay is never held by her wishes. */
  | { readonly kind: "keep_paying"; readonly payeeId: string }
  /** "Hold anything that is not care": refills, purchases, help, settlements and the pay of caregivers she did not name wait. */
  | { readonly kind: "pause_discretionary" }
  /** "If I go into a home, cancel the gym and the magazine": suspended through PayPal, resumed if she comes home. */
  | { readonly kind: "suspend_subscriptions"; readonly subscriptionIds: readonly string[] }
  /** "Nothing over 200 dollars to anyone new unless Elena and Marcus both agree." */
  | { readonly kind: "new_payee_approvals"; readonly aboveCents: number; readonly approverMemberIds: readonly string[] }
  /** "If I can't decide, Marcus runs things": the organizer's seat passes to the member she named, and back when she is home. */
  | { readonly kind: "successor"; readonly memberId: string };

/** A wish as she said it and as a rule, before it is stored. */
export type WishDraft = {
  /** Her own words, kept exactly as said or typed. */
  readonly quote: string;
  readonly trigger: WishTrigger;
  readonly rule: WishRule;
};

/** The longest wish Kin keeps, in characters: a few sentences, said at once. */
export const MAX_WISH_CHARS = 500;
/** The most subscriptions one wish names. */
export const MAX_WISH_SUBSCRIPTIONS = 12;
/** How many members other than the parent witness a wish before it is in force. */
export const WISH_WITNESSES = 2;
/** Who may witness a wish: the family members who share the cost. A caregiver may be paid under one, and an observer never writes. */
export const WITNESS_ROLES = ["organizer", "contributor"] as const satisfies readonly CircleRole[];
/** Who a "two approvals" wish may name, and who may succeed the organizer. */
export const DECIDING_ROLES = ["organizer", "contributor"] as const satisfies readonly CircleRole[];

/**
 * `quote`: empty, too long, or holds markup.
 * `trigger` / `kind`: not one Kin knows.
 * `payee`: not a caregiver of this circle with a pay rate.
 * `subscriptions`: none named, too many, repeated, or one not the parent's.
 * `amount`: not a whole number of cents above zero.
 * `approvers`: fewer than two different family members who share the cost, or the parent.
 * `successor`: not a member who could run the circle, or already its organizer.
 */
export type WishRuleReason = "quote" | "trigger" | "kind" | "payee" | "subscriptions" | "amount" | "approvers" | "successor";

/** A wish cannot be made into a rule as drafted. Retrying the same draft cannot help. */
export class WishRuleError extends Error {
  readonly retryable = false;
  readonly reason: WishRuleReason;

  constructor(reason: WishRuleReason) {
    super(`The wish cannot be kept as a rule: ${reason}`);
    this.name = "WishRuleError";
    this.reason = reason;
  }
}

/** What a draft is checked against: the circle's own record. */
export type WishContext = {
  readonly members: readonly { readonly id: string; readonly role: CircleRole; readonly active: boolean }[];
  /** The caregivers' payees with a pay rate. */
  readonly caregiverPayeeIds: readonly string[];
  readonly subscriptionIds: readonly string[];
};

const MARKUP = /[<>]/u;

/** Her words, with runs of space made one, or `null` when there is nothing to keep. */
export function cleanQuote(text: string): string | null {
  const quote = text.replace(/\s+/gu, " ").trim();
  return quote === "" ? null : quote;
}

/**
 * Checks a draft against the record and returns it clean, or throws a
 * `WishRuleError`. The database checks the same things again.
 */
export function checkWishDraft(draft: WishDraft, context: WishContext): WishDraft {
  const quote = cleanQuote(draft.quote);
  if (quote === null || quote.length > MAX_WISH_CHARS || MARKUP.test(quote)) throw new WishRuleError("quote");
  if (!WISH_TRIGGERS.includes(draft.trigger)) throw new WishRuleError("trigger");
  return { quote, trigger: draft.trigger, rule: checkRule(draft.rule, context) };
}

function checkRule(rule: WishRule, context: WishContext): WishRule {
  const active = (id: string, roles: readonly CircleRole[]) => context.members.some((member) => member.id === id && member.active && roles.includes(member.role));
  switch (rule.kind) {
    case "keep_paying":
      if (!context.caregiverPayeeIds.includes(rule.payeeId)) throw new WishRuleError("payee");
      return { kind: "keep_paying", payeeId: rule.payeeId };
    case "pause_discretionary":
      return { kind: "pause_discretionary" };
    case "suspend_subscriptions": {
      const ids = rule.subscriptionIds;
      if (ids.length === 0 || ids.length > MAX_WISH_SUBSCRIPTIONS || new Set(ids).size !== ids.length) throw new WishRuleError("subscriptions");
      if (!ids.every((id) => context.subscriptionIds.includes(id))) throw new WishRuleError("subscriptions");
      return { kind: "suspend_subscriptions", subscriptionIds: [...ids] };
    }
    case "new_payee_approvals": {
      if (!Number.isSafeInteger(rule.aboveCents) || rule.aboveCents <= 0) throw new WishRuleError("amount");
      assertCents(rule.aboveCents);
      const ids = rule.approverMemberIds;
      if (ids.length < WISH_WITNESSES || new Set(ids).size !== ids.length || !ids.every((id) => active(id, DECIDING_ROLES))) throw new WishRuleError("approvers");
      return { kind: "new_payee_approvals", aboveCents: rule.aboveCents, approverMemberIds: [...ids] };
    }
    case "successor":
      if (!active(rule.memberId, ["contributor"])) throw new WishRuleError("successor");
      return { kind: "successor", memberId: rule.memberId };
    default:
      throw new WishRuleError("kind");
  }
}

/** Whether a wish written for `trigger` applies when `event` is attested. */
export const wishApplies = (trigger: WishTrigger, event: TriggerEvent): boolean => trigger === "either" || trigger === event;

// ---------------------------------------------------------------------------
// A wish's life: drafted, confirmed by her, witnessed, in force
// ---------------------------------------------------------------------------

/**
 * A draft is what Kin read back. She confirms it; two family members witness
 * it and it is in force. A new version of the same wish supersedes it once
 * that version is in force, and she may withdraw a wish at any time she can
 * decide. Versions are never edited in place: a change is a new version.
 */
export const WISH_TRANSITIONS = {
  draft: ["confirmed", "withdrawn"],
  confirmed: ["in_force", "withdrawn"],
  in_force: ["superseded", "withdrawn"],
  superseded: [],
  withdrawn: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type WishState = keyof typeof WISH_TRANSITIONS;
export const WISH_STATES = Object.keys(WISH_TRANSITIONS) as [WishState, ...WishState[]];

export const wishMoveAllowed = (from: WishState, to: WishState): boolean => (WISH_TRANSITIONS[from] as readonly WishState[]).includes(to);

/** One signature on a wish: hers as the one who said it, or a witness's. Each signs the wish's digest. */
export type WishSignature = { readonly memberId: string; readonly role: CircleRole; readonly capacity: "parent" | "witness"; readonly digest: string };

/**
 * Whether the witnesses a wish needs have signed: two different members who
 * share the cost, neither the parent, each over the digest the wish carries.
 * A successor never witnesses the wish that names them.
 */
export function witnessed(wish: { readonly digest: string; readonly rule: WishRule }, signatures: readonly WishSignature[]): boolean {
  const named = wish.rule.kind === "successor" ? wish.rule.memberId : null;
  const witnesses = new Set(
    signatures
      .filter((signature) => signature.capacity === "witness" && signature.digest === wish.digest && signature.memberId !== named && (WITNESS_ROLES as readonly CircleRole[]).includes(signature.role))
      .map((signature) => signature.memberId),
  );
  const parents = new Set(signatures.filter((signature) => signature.role === "parent").map((signature) => signature.memberId));
  return [...witnesses].filter((id) => !parents.has(id)).length >= WISH_WITNESSES;
}

// ---------------------------------------------------------------------------
// What her wishes do while a trigger is active
// ---------------------------------------------------------------------------

/** A wish in force, as the effects read it. */
export type InForceWish = {
  readonly id: string;
  /** The same for every version of one wish. */
  readonly wishKey: string;
  readonly version: number;
  readonly quote: string;
  /** The circle's day she said it. */
  readonly saidOn: string;
  readonly trigger: WishTrigger;
  readonly rule: WishRule;
};

/** A trigger two people attested, which is in effect. */
export type ActiveTrigger = { readonly id: string; readonly event: TriggerEvent; readonly activeAt: Date };

export type WishEffects = {
  readonly trigger: ActiveTrigger;
  /** The caregivers' payees her wishes keep paid, each with the wish that says so. */
  readonly keepPaying: readonly { readonly payeeId: string; readonly wish: InForceWish }[];
  /** The wish that holds discretionary spending, or `null` when none does. */
  readonly discretionary: InForceWish | null;
  readonly subscriptions: readonly { readonly subscriptionId: string; readonly wish: InForceWish }[];
  readonly newPayees: readonly { readonly aboveCents: number; readonly approverMemberIds: readonly string[]; readonly wish: InForceWish }[];
  /** Who runs the circle while it lasts, or `null` when no wish names anyone. The latest she said decides. */
  readonly successor: { readonly memberId: string; readonly wish: InForceWish } | null;
};

/**
 * What her wishes in force do while `trigger` is active, by plain code: each
 * wish whose trigger matches the attested event applies, as written. `null`
 * when nothing is active.
 */
export function wishEffects(wishes: readonly InForceWish[], trigger: ActiveTrigger | null): WishEffects | null {
  if (trigger === null) return null;
  const applying = wishes.filter((wish) => wishApplies(wish.trigger, trigger.event)).toSorted(bySaid);
  const keepPaying: { payeeId: string; wish: InForceWish }[] = [];
  const subscriptions: { subscriptionId: string; wish: InForceWish }[] = [];
  const newPayees: { aboveCents: number; approverMemberIds: readonly string[]; wish: InForceWish }[] = [];
  let discretionary: InForceWish | null = null;
  let successor: { memberId: string; wish: InForceWish } | null = null;
  for (const wish of applying) {
    const { rule } = wish;
    if (rule.kind === "keep_paying" && !keepPaying.some((each) => each.payeeId === rule.payeeId)) keepPaying.push({ payeeId: rule.payeeId, wish });
    if (rule.kind === "pause_discretionary") discretionary ??= wish;
    if (rule.kind === "suspend_subscriptions") {
      for (const subscriptionId of rule.subscriptionIds) if (!subscriptions.some((each) => each.subscriptionId === subscriptionId)) subscriptions.push({ subscriptionId, wish });
    }
    if (rule.kind === "new_payee_approvals") newPayees.push({ aboveCents: rule.aboveCents, approverMemberIds: rule.approverMemberIds, wish });
    if (rule.kind === "successor") successor = { memberId: rule.memberId, wish };
  }
  return { trigger, keepPaying, discretionary, subscriptions, newPayees, successor };
}

// Oldest first, so the first of a kind is the one she said first and a later successor replaces an earlier one.
const bySaid = (a: InForceWish, b: InForceWish): number => a.saidOn.localeCompare(b.saidOn) || a.version - b.version || a.id.localeCompare(b.id);

/** Kinds of outgoing money, as her wishes sort them. */
export const SPEND_KINDS = ["caregiver_payout", "purchase", "member_payout", "help_payout", "allowance", "bill_payment"] as const;
export type SpendKind = (typeof SPEND_KINDS)[number];

export type WishHold =
  /** Not held. `protectedBy` is the wish that keeps it paid, when one does: the payment cites her. */
  | { readonly held: false; readonly protectedBy: InForceWish | null }
  | { readonly held: true; readonly by: InForceWish };

/**
 * Whether her wishes hold a payment while a trigger is active. A caregiver she
 * named in a keep-paying wish is always paid, whatever else her wishes say;
 * everything else waits while a wish pauses discretionary spending.
 */
export function wishHoldFor(effects: WishEffects | null, spend: { readonly kind: SpendKind; readonly payeeId: string | null }): WishHold {
  if (effects === null) return { held: false, protectedBy: null };
  const kept = spend.kind === "caregiver_payout" && spend.payeeId !== null ? (effects.keepPaying.find((each) => each.payeeId === spend.payeeId)?.wish ?? null) : null;
  if (kept !== null) return { held: false, protectedBy: kept };
  return effects.discretionary === null ? { held: false, protectedBy: null } : { held: true, by: effects.discretionary };
}

export type DiscretionaryPause =
  | { readonly paused: false }
  | { readonly paused: true; readonly wish: InForceWish; readonly trigger: ActiveTrigger };

/**
 * The one answer to "is discretionary spending paused for this circle, and
 * why": paused while a trigger is active and a wish in force pauses it, with
 * that wish to cite. Anything that spends on the parent's behalf beyond care
 * (refills, purchases, an allowance) asks this before it spends.
 */
export function discretionaryPause(effects: WishEffects | null): DiscretionaryPause {
  return effects === null || effects.discretionary === null ? { paused: false } : { paused: true, wish: effects.discretionary, trigger: effects.trigger };
}

/** The approvals her wishes add to a payment: every member named must say yes, and the wishes that ask it. */
export type WishApproval = { readonly memberIds: readonly string[]; readonly wishIds: readonly string[] };

/**
 * What her wishes require before a payment to a payee the family has not
 * approved may go, while a trigger is active: each rule whose amount it is
 * over adds its named members. `null` when none applies.
 */
export function wishApprovalFor(effects: WishEffects | null, payment: { readonly cents: number; readonly payeeStatus: "approved" | "new" | null }): WishApproval | null {
  if (effects === null || payment.payeeStatus !== "new") return null;
  const rules = effects.newPayees.filter((rule) => payment.cents > rule.aboveCents);
  if (rules.length === 0) return null;
  return { memberIds: [...new Set(rules.flatMap((rule) => rule.approverMemberIds))], wishIds: rules.map((rule) => rule.wish.id) };
}

/**
 * Whether the yeses given meet her wish: every named member other than the
 * payee said yes, and at least two different members other than the payee
 * did. One person can never meet it alone, and neither can the payee.
 */
export function wishApprovalMet(requirement: WishApproval, yeses: readonly string[], payeeMemberId: string | null): boolean {
  const said = new Set(yeses.filter((memberId) => memberId !== payeeMemberId));
  const named = requirement.memberIds.filter((memberId) => memberId !== payeeMemberId);
  return said.size >= WISH_WITNESSES && named.every((memberId) => said.has(memberId));
}
