import { wordCoverNote, wordShiftQuestion, type CoverNoteFacts, type ShiftQuestionFacts, type ShiftWording, type StructuredModel } from "@kin/agent";
import type { BillingAccount } from "@kin/auth";

import { createRateLimiter, spendUse, structuredModel, type RateLimiter } from "./model";

/**
 * Where Claude words two sentences about care shifts: the question put to the
 * parent about a visit, and the note beside the people who could cover a
 * shift. Only the server calls it, never the browser. Whatever the model is
 * doing, the person gets a sentence at once: a wording already made is reused,
 * a new one is waited for only briefly, and the fixed wording stands in when
 * the model is off, busy, slow, refused or over its limit.
 */

/** How long a page waits for the model before showing the fixed wording. The model's answer is kept for the next look. */
export const WORDING_DEADLINE_MS = 6_000;
const KEEP_MS = 10 * 60_000;
/** A failure is not kept as long: the model may be back in a moment. */
const KEEP_FAILURE_MS = 30_000;
const MAX_ENTRIES = 500;

/** Each person may have thirty sentences worded an hour; each server 200 for demo visitors and 200 for people. */
const personLimiter = createRateLimiter(30, 60 * 60_000);
const poolBudget = createRateLimiter(200, 60 * 60_000);

type Entry = { expires: number; promise: Promise<ShiftWording> };
export type WordingCache = Map<string, Entry>;

export type WordingDeps = {
  /** Claude, or `null` when this deployment has no model. */
  readonly model: StructuredModel | null;
  readonly cache: WordingCache;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
  readonly deadlineMs?: number;
};

export type WordingWho = { readonly userId: string; readonly accountTypes: BillingAccount };

const sharedCache: WordingCache = new Map();

/** The usual services: the configured model, the shared cache and the real limits. */
export function wordingDeps(): WordingDeps {
  return { model: structuredModel(), cache: sharedCache, limiter: personLimiter, budget: poolBudget };
}

const retryable = (wording: ShiftWording): boolean =>
  wording.provenance.source === "template" && ["model_busy", "model_unavailable", "unreadable"].includes(wording.provenance.reason);

function remember(deps: WordingDeps, key: string, promise: Promise<ShiftWording>, now: number): void {
  const { cache } = deps;
  if (cache.size >= MAX_ENTRIES) {
    // Expired entries first, then the oldest: the map is bounded whatever people ask.
    for (const [each, entry] of cache) if (entry.expires <= now) cache.delete(each);
    const oldest = cache.keys().next();
    if (cache.size >= MAX_ENTRIES && !oldest.done) cache.delete(oldest.value);
  }
  const entry: Entry = { expires: now + KEEP_MS, promise };
  cache.set(key, entry);
  // Once it is known, a failure is kept for less time than a success.
  void promise.then((wording) => {
    if (retryable(wording)) entry.expires = Math.min(entry.expires, now + KEEP_FAILURE_MS);
  });
}

/** The fixed wording with its reason changed: the model was not asked, or not answered in time. */
const withReason = (fixed: ShiftWording, reason: "limit_reached" | "model_unavailable"): ShiftWording => ({ ...fixed, provenance: { source: "template", reason } });

/**
 * One worded sentence, from the cache when it is there, otherwise from the
 * model if the person and the server still have a use left, waiting at most
 * the deadline. `fixed` is the fixed wording, the answer whenever the model
 * is not.
 */
async function wordedOnce(deps: WordingDeps, who: WordingWho, key: string, ask: (model: StructuredModel) => Promise<ShiftWording>, fixed: ShiftWording): Promise<ShiftWording> {
  const { model } = deps;
  if (model === null) return fixed;
  const now = deps.now?.() ?? Date.now();
  const kept = deps.cache.get(key);
  let pending = kept !== undefined && kept.expires > now ? kept.promise : null;
  if (pending === null) {
    if (!spendUse({ limiter: deps.limiter, budget: deps.budget }, who, now)) return withReason(fixed, "limit_reached");
    pending = ask(model);
    remember(deps, key, pending, now);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ShiftWording>((resolve) => {
    timer = setTimeout(() => resolve(withReason(fixed, "model_unavailable")), deps.deadlineMs ?? WORDING_DEADLINE_MS);
  });
  try {
    return await Promise.race([pending, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A member's first name: what the family calls them, and all the model's sentences need. */
export const firstNameOf = (displayName: string): string => displayName.trim().split(/\s+/u)[0] ?? displayName;

const part = (value: string | null): string => value ?? "";

export function questionKey(userId: string, shiftId: string, facts: ShiftQuestionFacts): string {
  return JSON.stringify(["question", userId, shiftId, facts.language, facts.caregiver, facts.part, part(facts.checkedOutAt), part(facts.title)]);
}

export function coverKey(userId: string, shiftId: string, facts: CoverNoteFacts): string {
  return JSON.stringify(["cover", userId, shiftId, facts.language, facts.when, part(facts.title), facts.candidates.map((each) => [each.name, each.kind, each.hoursThatDay, each.hoursThisWeek])]);
}

/** The question for one visit, worded by the model or, failing that, fixed. */
export async function wordedQuestion(deps: WordingDeps, who: WordingWho, shiftId: string, facts: ShiftQuestionFacts): Promise<ShiftWording> {
  const fixed = await wordShiftQuestion(null, facts);
  return wordedOnce(deps, who, questionKey(who.userId, shiftId, facts), (model) => wordShiftQuestion(model, facts), fixed);
}

/** The note about who could cover one shift, or `null` when nobody could. */
export async function wordedCoverNote(deps: WordingDeps, who: WordingWho, shiftId: string, facts: CoverNoteFacts): Promise<ShiftWording | null> {
  const fixed = await wordCoverNote(null, facts);
  if (fixed === null) return null;
  return wordedOnce(deps, who, coverKey(who.userId, shiftId, facts), async (model) => (await wordCoverNote(model, facts)) ?? fixed, fixed);
}

/** Whether a wording says something about the model, so the screen shows who made it: not when no model is switched on. */
export function worthABadge(wording: ShiftWording): boolean {
  return wording.provenance.source === "claude" || wording.provenance.reason !== "not_configured";
}
