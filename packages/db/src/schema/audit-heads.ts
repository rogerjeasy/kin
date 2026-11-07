import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { at, circleId, id } from "./columns.ts";
import { circles, members } from "./circles.ts";

/**
 * The head of a circle's ledger hash chain as it stood when Kin showed or
 * exported it. The chain itself is computed from the entries; these rows are
 * the memory that lets a later export be checked against an earlier one.
 * Append-only: a head is never changed or removed, and the same head at the
 * same entry count is kept once.
 */
export const auditHeads = pgTable(
  "audit_heads",
  {
    id: id(),
    circleId: circleId(),
    /** How many ledger entries the chain had. 0 is the empty chain. */
    entryCount: integer("entry_count").notNull(),
    /** The chain's last hash (SHA-256, lower-case hex) after that many entries. */
    head: text("head").notNull(),
    /** What made Kin note it: the verify page or a downloaded export. */
    kind: text("kind").notNull(),
    /** The member whose request recorded it. */
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: at("recorded_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ name: "audit_heads_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "audit_heads_member_fk", columns: [t.circleId, t.recordedBy], foreignColumns: [members.circleId, members.id] }),
    unique("audit_heads_once").on(t.circleId, t.entryCount, t.head),
    index("audit_heads_circle_idx").on(t.circleId, t.entryCount),
    check("audit_heads_count", sql`${t.entryCount} >= 0`),
    check("audit_heads_hash", sql`${t.head} ~ '^[0-9a-f]{64}$'`),
    check("audit_heads_kind", sql`${t.kind} in ('verify', 'export')`),
  ],
);
