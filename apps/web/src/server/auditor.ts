import { reviewFindings, type ReviewItem, type ReviewedItem } from "@kin/agent";
import type { BillingAccount } from "@kin/auth";

import { createRateLimiter, spendUse, structuredModel } from "./model";

/** Each person may ask the auditor ten times an hour; each server 100 times for demo visitors and 100 for people. */
const auditorLimiter = createRateLimiter(10, 60 * 60 * 1000);
const auditorBudget = createRateLimiter(100, 60 * 60 * 1000);

export type AuditorStatus = "not_asked" | "worded" | "unavailable" | "busy";

export type AuditorReview = { readonly items: readonly ReviewedItem[]; readonly status: AuditorStatus };

/**
 * The auditor's wording of the findings, if the person asked for it, a model
 * is configured and they are within their limits. In every other case the
 * findings carry Kin's fixed sentences, so the screen is complete either way.
 */
export async function auditorReview(
  items: readonly ReviewItem[],
  language: string,
  ask: { readonly asked: boolean; readonly userId: string; readonly accountTypes: BillingAccount },
): Promise<AuditorReview> {
  const fixed = await reviewFindings(null, items, language);
  if (!ask.asked || items.length === 0) return { items: fixed, status: "not_asked" };
  const model = structuredModel();
  if (model === null) return { items: fixed, status: "unavailable" };
  if (!spendUse({ limiter: auditorLimiter, budget: auditorBudget }, ask, Date.now())) return { items: fixed, status: "busy" };
  return { items: await reviewFindings(model, items, language), status: "worded" };
}
