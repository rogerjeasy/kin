import { readSandboxPayoutConfig } from "@kin/config";
import { asPerson, readExecutions, type CircleSnapshot } from "@kin/db";
import { cache } from "react";

import { demoPayee, payoutProofs, type DemoPayee } from "@/content/circle/payout-proof";

import { databases } from "./database";
import type { Viewer } from "./viewer";

let sandboxOn: boolean | undefined;

/**
 * Whether the worker pays demo caregiver payouts through PayPal's sandbox
 * (KIN_DEMO_SANDBOX_PAYEE_EMAIL set on both). Read the first time a request
 * needs it, never at build time. The address itself never reaches a page.
 */
function sandboxPayoutsOn(): boolean {
  sandboxOn ??= readSandboxPayoutConfig(process.env).enabled;
  return sandboxOn;
}

/** How this circle's caregiver payouts are paid, for the words that say so. */
export function demoPayeeOf(circle: CircleSnapshot): DemoPayee {
  return demoPayee(circle.circle.demo, sandboxPayoutsOn());
}

/** PayPal's batch and item for each payout the viewer may see, read as them. Read once per request. */
export const payoutProofsOf = cache(async (viewer: Viewer, circleId: string) =>
  payoutProofs(await asPerson(databases().app, viewer.userId, (tx) => readExecutions(tx, circleId))),
);
