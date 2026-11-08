import { bedrockModel, bedrockToolModel, type StructuredModel, type ToolModel } from "@kin/agent";
import type { BillingAccount } from "@kin/auth";
import { readModelConfig } from "@kin/config";

let model: StructuredModel | null | undefined;

/** Claude, or `null` when this deployment has no model. Read on first use, never at build time. */
export function structuredModel(): StructuredModel | null {
  if (model === undefined) {
    const config = readModelConfig(process.env);
    model = config.enabled ? bedrockModel(config) : null;
  }
  return model;
}

export type RateLimiter = {
  /** Whether `key` has a use left now. Records nothing. */
  allows(key: string, now: number): boolean;
  /** Records one use of `key`. Call only after every limit has allowed it. */
  record(key: string, now: number): void;
};

/** The most people one limiter tracks; past it, newcomers are refused rather than memory growing. */
const MAX_KEYS = 20_000;

/**
 * At most `limit` uses per key in any `windowMs`. Kept in this server's
 * memory: it bounds what can be spent on the model from one instance, and
 * is not a guarantee across instances. Its memory and work are bounded:
 * expired keys are swept at most ten times a window, and when it is full a
 * key it does not know is refused.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const uses = new Map<string, number[]>();
  let lastSweep = Number.NEGATIVE_INFINITY;
  const recentAt = (key: string, now: number) => (uses.get(key) ?? []).filter((at) => now - at < windowMs);
  const sweep = (now: number) => {
    if (now - lastSweep < windowMs / 10) return;
    lastSweep = now;
    for (const [key, times] of uses) if (times.every((at) => now - at >= windowMs)) uses.delete(key);
  };
  return {
    allows(key, now) {
      if (!uses.has(key) && uses.size >= MAX_KEYS) {
        sweep(now);
        if (uses.size >= MAX_KEYS) return false;
      }
      return recentAt(key, now).length < limit;
    },
    record(key, now) {
      uses.set(key, [...recentAt(key, now), now]);
    },
  };
}

/** Each person may ask Kin to read their visits ten times an hour. */
export const visitReadingLimiter = createRateLimiter(10, 60 * 60 * 1000);

/**
 * And each server at most 200 times an hour for demo visitors, and as many
 * again for people who signed in, whoever asks: anyone can become a new demo
 * visitor, so a per-person limit alone does not bound spend, and the demo's
 * visitors must never use up what families rely on.
 */
export const visitReadingBudget = createRateLimiter(200, 60 * 60 * 1000);

/** Each person may hold up twenty letters or checks an hour; each server 200 for demo visitors and 200 for people. */
export const letterLimiter = createRateLimiter(20, 60 * 60 * 1000);
export const letterBudget = createRateLimiter(200, 60 * 60 * 1000);

/**
 * Spends one use of a paid service, if the person and the pool both still
 * have one. Every limit is asked before any is used, so a refused request
 * costs nothing.
 */
export function spendUse(limits: { readonly limiter?: RateLimiter; readonly budget?: RateLimiter }, who: { readonly userId: string; readonly accountTypes: BillingAccount }, at: number): boolean {
  const pool = who.accountTypes === "demo" ? "demo" : "people";
  const asked = [
    ...(limits.limiter ? [{ limiter: limits.limiter, key: who.userId }] : []),
    ...(limits.budget ? [{ limiter: limits.budget, key: pool }] : []),
  ];
  if (!asked.every(({ limiter, key }) => limiter.allows(key, at))) return false;
  for (const { limiter, key } of asked) limiter.record(key, at);
  return true;
}

/** Each person may ask Kin ten questions an hour; each server 200 for demo visitors and 200 for people. */
export const askKinLimiter = createRateLimiter(10, 60 * 60 * 1000);
export const askKinBudget = createRateLimiter(200, 60 * 60 * 1000);

let tools: ToolModel | null | undefined;

/** Claude with Ask Kin's tools, or `null` when this deployment has no model. Read on first use, never at build time. */
export function toolModel(): ToolModel | null {
  if (tools === undefined) {
    const config = readModelConfig(process.env);
    tools = config.enabled ? bedrockToolModel(config) : null;
  }
  return tools;
}
