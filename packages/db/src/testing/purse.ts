import type { Database } from "../connection.ts";
import { beginPursePayment, confirmPursePayment, lockPurseJob, readPurseContext, readPurseJobs } from "../purse.ts";
import { asService } from "../scope.ts";

/**
 * Does what Kin's worker does for a demo circle's approved Purse payments:
 * readies each one and pays it, simulated, as the worker's own service
 * identity. No worker runs beside the end-to-end app, so a test that needs a
 * payment to turn "sent" on screen calls this. A real circle's payments are
 * left alone: they go to PayPal, which only the worker reaches.
 */
export async function payPurseAsWorker(service: Database, circleId: string): Promise<number> {
  return asService(service, circleId, async (tx) => {
    const context = await readPurseContext(tx, circleId, new Date());
    if (context === null || !context.simulated) return 0;
    let paid = 0;
    for (const listed of await readPurseJobs(tx, circleId)) {
      const job = await lockPurseJob(tx, circleId, listed.paymentId);
      if (job === null || job.state !== "approved") continue;
      if ((await beginPursePayment(tx, context, job, 0)) !== "ready") continue;
      await confirmPursePayment(tx, context, { ...job, state: "executing" }, { itemId: `simulated-purse-${job.paymentId}`, batchId: null, feeCents: 0, at: context.now });
      paid += 1;
    }
    return paid;
  });
}
