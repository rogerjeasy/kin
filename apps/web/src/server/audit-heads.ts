import { authorize } from "@kin/auth";
import { asPerson, readAuditHeads, recordAuditHead, type AuditHeadKind, type CircleSnapshot, type Database } from "@kin/db";
import type { AuditBundle, StoredHead } from "@kin/verify";

/** The heads Kin kept before now, as the person looking may read them, ready to go into an export. */
export async function keptHeads(db: Database, userId: string, circle: CircleSnapshot): Promise<StoredHead[]> {
  const rows = await asPerson(db, userId, (tx) => readAuditHeads(tx, circle.circle.id));
  return rows.map((row) => ({ count: row.entryCount, head: row.head, recordedAt: row.recordedAt.toISOString() }));
}

/**
 * Has Kin keep the head of the record that was just checked or exported, once:
 * asking again for the same head changes nothing. Only the members who may
 * write it do (an observer reads and never writes); the database decides
 * again. Call it after the check, so the check stands against earlier heads only.
 */
export async function keepHead(db: Database, userId: string, circle: CircleSnapshot, bundle: AuditBundle, kind: AuditHeadKind): Promise<void> {
  if (!authorize({ role: circle.viewer.role, status: "active" }, "audit_head.keep").allowed) return;
  await asPerson(db, userId, (tx) => recordAuditHead(tx, { circleId: circle.circle.id, entryCount: bundle.entries.length, head: bundle.head, kind }));
}
