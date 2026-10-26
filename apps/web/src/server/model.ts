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

/**
 * At most `limit` uses per key in any `windowMs`. Kept in this server's
 * memory: it bounds what one person can spend on the model from one
 * instance, and is not a guarantee across instances.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const uses = new Map<string, number[]>();
  return {
    take(key, now) {
      const recent = (uses.get(key) ?? []).filter((at) => now - at < windowMs);
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
