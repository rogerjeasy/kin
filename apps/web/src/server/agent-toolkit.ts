import { readPayPalConfig } from "@kin/config";
import { agentToolkitFor, type AgentToolkitReads } from "@kin/paypal";

let reads: AgentToolkitReads | null | undefined;

/**
 * The PayPal Agent Toolkit's reads for Ask Kin, over the pool's PayPal app,
 * or `null` when this deployment has no PayPal app or talks to a stand-in.
 * Read on first use, never at build time; the toolkit itself loads on its
 * first read.
 */
export function agentToolkit(): AgentToolkitReads | null {
  if (reads === undefined) {
    const paypal = readPayPalConfig(process.env, { webhook: false });
    reads = paypal.enabled ? agentToolkitFor(paypal) : null;
  }
  return reads;
}
