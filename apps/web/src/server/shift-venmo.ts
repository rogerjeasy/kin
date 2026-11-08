import { readPayPalConfig } from "@kin/config";
import type { CircleSnapshot } from "@kin/db";

/** What the Venmo choice must say: PayPal's sandbox refuses Venmo, and a demo only simulates it. */
export type VenmoNote = "refused" | "simulated";

let sandboxConfigured: boolean | undefined;

/**
 * Whether this deployment talks to PayPal's sandbox (the only PayPal Kin talks
 * to), which is the case once a PayPal app is configured. Read on first use,
 * never at build time.
 */
function paypalSandboxOn(): boolean {
  sandboxConfigured ??= readPayPalConfig(process.env, { webhook: false }).enabled;
  return sandboxConfigured;
}

/**
 * The note beside the Venmo choice, or `null` when there is nothing to warn
 * of. PayPal's sandbox refuses every Venmo payout item, so in a real circle
 * against the sandbox a Venmo payout would fail; a demo circle's Venmo payout
 * is simulated and labelled so (the worker does the same).
 */
export function venmoNote(circle: CircleSnapshot, sandboxOn: boolean = paypalSandboxOn()): VenmoNote | null {
  if (circle.circle.demo) return "simulated";
  return sandboxOn ? "refused" : null;
}
