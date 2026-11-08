import type { ExecutionState } from "@kin/domain";
import { asc, eq } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { executions } from "./schema/index.ts";

/** One attempt to carry out an approved payment through PayPal, as a person may read it. */
export type ExecutionRecord = {
  readonly id: string;
  readonly proposalId: string;
  readonly state: ExecutionState;
  /** PayPal's IDs, from Kin's own record: never taken from a request or a model. */
  readonly paypalBatchId: string | null;
  readonly paypalItemId: string | null;
  readonly submittedAt: Date | null;
  readonly confirmedAt: Date | null;
};

/**
 * The circle's executions, oldest first. Run inside `asPerson`: row-level
 * security decides which come back, so a caregiver reads only the ones that
 * pay them and another circle's never.
 */
export async function readExecutions(tx: Transaction, circleId: string): Promise<ExecutionRecord[]> {
  return tx
    .select({
      id: executions.id,
      proposalId: executions.proposalId,
      state: executions.state,
      paypalBatchId: executions.paypalBatchId,
      paypalItemId: executions.paypalItemId,
      submittedAt: executions.submittedAt,
      confirmedAt: executions.confirmedAt,
    })
    .from(executions)
    .where(eq(executions.circleId, circleId))
    .orderBy(asc(executions.createdAt));
}
