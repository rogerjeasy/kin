import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { MAX_RECEIPT_CENTS, MAX_RECEIPT_DESCRIPTION, RECEIPT_CATEGORIES } from "@kin/domain";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { receiptState } from "./enums.ts";

/**
 * A member's receipt for money they spent from their own pocket for the
 * parent. Another member approves it, and Kin's worker then credits it to the
 * member in the ledger as an out-of-pocket entry; this row never holds money.
 */
export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    circleId: circleId(),
    /** The member who spent the money and is credited. */
    memberId: uuid("member_id").notNull(),
    category: text("category").notNull(),
    cents: cents("cents").notNull(),
    description: text("description").notNull(),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    state: receiptState("state").notNull().default("submitted"),
    /** The member who approved or rejected it. Never the member it credits. */
    decidedBy: uuid("decided_by"),
    decidedAt: at("decided_at"),
    /**
     * The ledger entry that credited it, once credited. Not a foreign key: a
     * truncate cascading from the ledger would then lock this table too, and
     * the ledger refuses a truncate anyway. The worker writes it from the
     * entry it has just written.
     */
    entryId: uuid("entry_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "receipts_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "receipts_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "receipts_decided_by_fk", columns: [t.circleId, t.decidedBy], foreignColumns: [members.circleId, members.id] }),
    unique("receipts_circle_row").on(t.circleId, t.id),
    index("receipts_state_idx").on(t.circleId, t.state),
    check("receipts_cents_range", sql.raw(`cents > 0 and cents <= ${MAX_RECEIPT_CENTS}`)),
    check("receipts_category", sql.raw(`category in (${RECEIPT_CATEGORIES.map((category) => `'${category}'`).join(", ")})`)),
    check("receipts_description", sql.raw(`length(trim(description)) > 0 and length(description) <= ${MAX_RECEIPT_DESCRIPTION}`)),
    check("receipts_decided_by_another", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.memberId}`),
    check("receipts_decision_recorded", sql`(${t.state} = 'submitted') = (${t.decidedBy} is null)`),
    check("receipts_credited_has_entry", sql`(${t.state} = 'credited') = (${t.entryId} is not null)`),
  ],
);
