import { calendarDay, outOfPocketApproved, type Receipt } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { operation, requiredId } from "./caregiver-billing.ts";
import type { Transaction } from "./connection.ts";
import { readAccountIds, writeEntries } from "./ledger-store.ts";
import { auditLog, bills, circles, ledgerEntries, receipts } from "./schema/index.ts";

/** The outbox topic that asks the worker to credit an approved receipt. */
export const RECEIPT_TOPIC = "receipt.credit";

/**
 * Files a receipt in the person's own name, as the person. `id` is chosen by
 * the caller, so the same request again files it once. The receipt must
 * already have passed `checkReceipt`; the database checks it again.
 */
export async function submitReceipt(tx: Transaction, input: { readonly circleId: string; readonly id: string; readonly receipt: Receipt }): Promise<string> {
  const { receipt } = input;
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.submit_receipt(${input.circleId}::uuid, ${input.id}::uuid, ${receipt.category}, ${receipt.cents}::bigint, ${receipt.description}, ${receipt.spentOn}::date) as id`,
    );
    return requiredId(result.rows[0]?.id);
  });
}

/** Another member approves or rejects a receipt, as that member. Approving queues its credit. */
export async function decideReceipt(tx: Transaction, input: { readonly circleId: string; readonly receiptId: string; readonly approve: boolean }): Promise<void> {
  await operation(() => tx.execute(sql`select kin_private.decide_receipt(${input.circleId}::uuid, ${input.receiptId}::uuid, ${input.approve})`));
}

export type CreditOutcome = "credited" | "already_credited" | "not_approved";

/**
 * Credits an approved receipt to the member who spent the money, as Kin's
 * service. The entry is built by the money core, keyed by the receipt, so a
 * retried or duplicated message writes nothing twice. A demo circle's entry
 * says it is simulated.
 */
export async function creditReceipt(tx: Transaction, circleId: string, receiptId: string, realNow: Date): Promise<CreditOutcome> {
  const [row] = await tx
    .select({
      id: receipts.id,
      memberId: receipts.memberId,
      category: receipts.category,
      cents: receipts.cents,
      description: receipts.description,
      state: receipts.state,
      billId: receipts.billId,
      currency: circles.currency,
      demo: circles.demo,
      clockAt: circles.clockAt,
      timezone: circles.timezone,
    })
    .from(receipts)
    .innerJoin(circles, eq(circles.id, receipts.circleId))
    .where(and(eq(receipts.circleId, circleId), eq(receipts.id, receiptId)))
    .for("update", { of: receipts });
  if (!row || (row.state !== "approved" && row.state !== "credited")) return "not_approved";
  if (row.state === "credited") return "already_credited";
  const at = row.clockAt ?? realNow;
  const entry = outOfPocketApproved(
    {
      id: randomUUID(),
      circleId,
      ...calendarDay(at, row.timezone),
      source: { type: "approval", id: `receipt-${row.id}` },
      currency: row.currency,
      simulated: row.demo,
      description: `${row.demo ? "Receipt (simulated)" : "Receipt"}: ${row.description}`,
    },
    { memberId: row.memberId, category: row.category, cents: row.cents },
  );
  // A repeat after a crash finds the entry the first try wrote, and links it.
  const [written] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.circleId, circleId), eq(ledgerEntries.sourceType, "approval"), eq(ledgerEntries.sourceId, `receipt-${row.id}`)));
  const entryId = written?.id ?? entry.id;
  if (!written) await writeEntries(tx, [entry], await readAccountIds(tx, circleId));
  await tx.update(receipts).set({ state: "credited", entryId }).where(and(eq(receipts.circleId, circleId), eq(receipts.id, row.id), eq(receipts.state, "approved")));
  // A bill a member paid outside Kin is paid once their receipt for it is credited.
  if (row.billId !== null) await tx.update(bills).set({ state: "paid" }).where(and(eq(bills.circleId, circleId), eq(bills.id, row.billId), eq(bills.state, "ready")));
  await tx.insert(auditLog).values({ id: randomUUID(), circleId, actor: "service", action: "receipt.credited", subjectType: "receipt", subjectId: row.id, details: { entryId, simulated: row.demo }, origin: "worker" });
  return "credited";
}
