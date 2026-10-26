import { bedrockModel, type StructuredModel } from "@kin/agent";
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
