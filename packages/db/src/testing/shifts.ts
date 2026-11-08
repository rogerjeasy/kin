import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { beginPayout, confirmPayout, readPayoutJob, recordSubmitted } from "../payouts.ts";
import { asPerson, asService } from "../scope.ts";
import { scheduleShift } from "../shifts.ts";
import type { ShiftKind } from "@kin/domain";
import type { TestDatabases } from "./databases.ts";
import type { VisitorCircle } from "./circles.ts";

/** The template's clock, in the demo circle every test starts from. */
export const CLOCK = new Date("2026-10-30T18:00:00Z");

/** Schedules a shift as the circle's organizer, on the demo clock's day unless told otherwise. */
export async function newShift(
  db: TestDatabases,
  circle: VisitorCircle,
  change: { kind?: ShiftKind; member?: "amara" | "ana" | "rose" | "marcus"; startsAt?: string; endsAt?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await asPerson(db.app, circle.userId, (tx) =>
    scheduleShift(tx, {
      circleId: circle.circleId,
      id,
      kind: change.kind ?? "aide",
      memberId: circle.members[change.member ?? "amara"],
      title: null,
      startsAt: new Date(change.startsAt ?? "2026-10-30T14:00:00Z"),
      endsAt: new Date(change.endsAt ?? "2026-10-30T20:00:00Z"),
    }),
  );
  return id;
}

/** What the worker does once PayPal has paid: begin the payout, send it, and confirm it. */
export async function payAsWorker(db: TestDatabases, circleId: string, proposalId: string): Promise<void> {
  const rows = await asService(db.service, circleId, async (tx) => (await tx.execute<{ id: string }>(sql`select id from executions where proposal_id = ${proposalId}`)).rows);
  const executionId = rows[0]?.id;
  if (executionId === undefined) throw new Error("The proposal has no execution");
  await asService(db.service, circleId, async (tx) => {
    const job = await readPayoutJob(tx, executionId, CLOCK);
    if (!job) throw new Error("No payout job");
    if ((await beginPayout(tx, job, 0)) !== "ready") throw new Error("The payout was not ready");
    await recordSubmitted(tx, job, null, CLOCK);
  });
  await asService(db.service, circleId, async (tx) => {
    const job = await readPayoutJob(tx, executionId, CLOCK);
    if (!job) throw new Error("No payout job");
    await confirmPayout(tx, job, { itemId: `test-item-${executionId}`, batchId: null, feeCents: 0, at: CLOCK });
  });
}

/** The deepest message of an error, which is the database's own. */
export function deepMessage(error: unknown): string {
  if (error instanceof Error && error.cause !== undefined) return `${error.message} ${deepMessage(error.cause)}`;
  return String(error instanceof Error ? error.message : error);
}
