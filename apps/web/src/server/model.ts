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

export type RateLimiter = { take(key: string, now: number): boolean };

/** Past this many people, stale entries are swept so the limiter's memory stays bounded. */
const SWEEP_ABOVE = 10_000;

/**
 * At most `limit` uses per key in any `windowMs`. Kept in this server's
 * memory: it bounds what can be spent on the model from one instance, and
 * is not a guarantee across instances.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const uses = new Map<string, number[]>();
  const recentAt = (key: string, now: number) => (uses.get(key) ?? []).filter((at) => now - at < windowMs);
  return {
    take(key, now) {
      if (uses.size > SWEEP_ABOVE) {
        for (const each of [...uses.keys()]) if (recentAt(each, now).length === 0) uses.delete(each);
      }
      const recent = recentAt(key, now);
      if (recent.length >= limit) {
        uses.set(key, recent);
        return false;
      }
      uses.set(key, [...recent, now]);
      return true;
    },
  };
}

/** Each person may ask Kin to read their visits ten times an hour. */
export const visitReadingLimiter = createRateLimiter(10, 60 * 60 * 1000);

/**
 * And the whole server at most 200 times an hour, whoever asks: anyone can
 * become a new demo visitor, so a per-person limit alone does not bound spend.
 */
export const visitReadingBudget = createRateLimiter(200, 60 * 60 * 1000);
/** The single key the server-wide budget counts under. */
export const WHOLE_SERVER = "*";
