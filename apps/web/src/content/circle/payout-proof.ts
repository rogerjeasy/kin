import type { ExecutionRecord } from "@kin/db";
import type { ExecutionState } from "@kin/domain";

/**
 * A payout PayPal's sandbox really made: its batch and item, from Kin's own
 * execution record, and where PayPal last said it stands. A simulated payout
 * has none, so it never shows one.
 */
export type PayoutProof = {
  readonly proposalId: string;
  readonly batchId: string;
  /** PayPal's payout item, once Kin has read it back. */
  readonly itemId: string | null;
  readonly state: ExecutionState;
};

// The worker names a simulated payment's item so; PayPal's own item IDs never start this way.
const SIMULATED_ITEM = "simulated-";

/** The executions PayPal has a batch for, by proposal and by PayPal item. */
export function payoutProofs(executions: readonly ExecutionRecord[]): { readonly byProposal: ReadonlyMap<string, PayoutProof>; readonly byItem: ReadonlyMap<string, PayoutProof> } {
  const proofs = executions
    // A batch PayPal failed, paid simulated instead, has a simulated item: it is not PayPal's payment.
    .filter((execution) => execution.paypalBatchId !== null && !(execution.paypalItemId ?? "").startsWith(SIMULATED_ITEM))
    .map((execution): PayoutProof => ({ proposalId: execution.proposalId, batchId: execution.paypalBatchId ?? "", itemId: execution.paypalItemId, state: execution.state }));
  return {
    byProposal: new Map(proofs.map((proof) => [proof.proposalId, proof])),
    byItem: new Map(proofs.filter((proof) => proof.itemId !== null).map((proof) => [proof.itemId ?? "", proof])),
  };
}

/** How a demo circle pays its caregivers: PayPal's sandbox to Kin's own test account, or simulated. `null` in a real circle. */
export type DemoPayee = "sandbox" | "simulated" | null;

export function demoPayee(demo: boolean, sandboxOn: boolean): DemoPayee {
  if (!demo) return null;
  return sandboxOn ? "sandbox" : "simulated";
}

/**
 * What a demo circle says instead of "the payment waits for an address": a
 * demo payment never waits for one, and never goes to one a visitor typed.
 */
export function demoPayeeNote(copy: { readonly receiverSandbox: string; readonly receiverSimulated: string }, payee: DemoPayee): string | null {
  if (payee === null) return null;
  return payee === "sandbox" ? copy.receiverSandbox : copy.receiverSimulated;
}
