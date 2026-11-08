import { markSandboxPayout, readSandboxFacts, readSandboxRoute, recordSandboxSkipped, type PayoutJob, type Transaction } from "@kin/db";
import { routeDemoPayout } from "@kin/domain";

/**
 * Real PayPal sandbox payouts for demo circles: where they go, and how many
 * may start in one UTC day. `null` keeps every demo payout simulated.
 */
export type SandboxPayouts = {
  /** Kin's own sandbox personal account. Never an address a visitor typed. */
  readonly payeeEmail: string;
  readonly dailyLimit: number;
  readonly budget: DailyBudget;
} | null;

/**
 * Sandbox payouts started per UTC day, across every demo circle. Kin's
 * service reads one circle at a time, so the count is kept by this worker:
 * a restart begins the day's count again (the per-circle limit, read from the
 * record, still holds).
 */
export type DailyBudget = { readonly used: (day: string) => number; readonly spend: (day: string) => void };

export function dailyBudget(): DailyBudget {
  const counts = new Map<string, number>();
  return {
    used: (day) => counts.get(day) ?? 0,
    spend: (day) => {
      const today = (counts.get(day) ?? 0) + 1;
      // Only today's count is kept: an earlier day can never be spent again.
      counts.clear();
      counts.set(day, today);
    },
  };
}

/** A payout Kin sends to PayPal's sandbox: real at PayPal, test money, never labelled simulated. */
export type SandboxJob = PayoutJob & { readonly sandbox: boolean };

/** The job as later turns must see it: a demo payout already routed to the sandbox is tracked at PayPal, to the address it was routed to. */
export async function routedJob(tx: Transaction, job: PayoutJob): Promise<SandboxJob> {
  if (!job.simulated) return { ...job, sandbox: false };
  const routed = await readSandboxRoute(tx, job);
  return routed === null ? { ...job, sandbox: false } : asSandbox(job, routed.receiver);
}

/**
 * Decides, for a demo payout just readied, whether it goes to the sandbox.
 * The approval engine has already approved it; this adds only limits, so it
 * can never make a payout happen that would not have happened simulated.
 */
export async function routeReadiedDemoPayout(tx: Transaction, job: PayoutJob, sandbox: SandboxPayouts, now: Date): Promise<SandboxJob> {
  if (sandbox === null) return { ...job, sandbox: false };
  const day = now.toISOString().slice(0, 10);
  const facts = await readSandboxFacts(tx, job);
  const route = routeDemoPayout({
    configured: true,
    kind: job.kind,
    approved: facts.approved,
    cents: job.cents,
    currency: job.currency,
    circlePayouts: facts.circlePayouts,
    todayPayouts: sandbox.budget.used(day),
    dailyLimit: sandbox.dailyLimit,
  });
  if (route.route === "simulated") {
    await recordSandboxSkipped(tx, job, route.reason);
    return { ...job, sandbox: false };
  }
  await markSandboxPayout(tx, job, sandbox.payeeEmail);
  sandbox.budget.spend(day);
  return asSandbox(job, sandbox.payeeEmail);
}

// The receiver is forced: whatever the demo caregiver's row or the execution holds, PayPal is told Kin's own address.
const asSandbox = (job: PayoutJob, receiver: string): SandboxJob => ({ ...job, simulated: false, receiver, sandbox: true });
