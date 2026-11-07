import { asc, eq, sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { auditHeads } from "./schema/index.ts";

/** What made Kin keep a head. */
export type AuditHeadKind = "verify" | "export";

/** A head Kin kept earlier: the chain's last hash after `entryCount` entries. */
export type AuditHeadRecord = { readonly entryCount: number; readonly head: string; readonly recordedAt: Date };

/**
 * Keeps the head of the circle's hash chain. The same head at the same entry
 * count is kept once, so asking again changes nothing; returns whether this
 * call added it. It keeps nothing, and says false, when the ledger no longer
 * holds that many entries (it took one since the app read it). The database
 * refuses anyone but an organizer, a contributor or the parent. Run as the
 * person, inside `asPerson`.
 */
export async function recordAuditHead(tx: Transaction, input: { readonly circleId: string; readonly entryCount: number; readonly head: string; readonly kind: AuditHeadKind }): Promise<boolean> {
  const result = await tx.execute<{ added: boolean }>(
    sql`select kin_private.record_audit_head(${input.circleId}::uuid, ${input.entryCount}::integer, ${input.head}, ${input.kind}) as added`,
  );
  return result.rows[0]?.added === true;
}

/** Every head kept for the circle, oldest first, as the person looking may see them. */
export async function readAuditHeads(tx: Transaction, circleId: string): Promise<AuditHeadRecord[]> {
  return tx
    .select({ entryCount: auditHeads.entryCount, head: auditHeads.head, recordedAt: auditHeads.recordedAt })
    .from(auditHeads)
    .where(eq(auditHeads.circleId, circleId))
    .orderBy(asc(auditHeads.recordedAt), asc(auditHeads.entryCount));
}
