import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { circleId, createdAt, id } from "./columns.ts";
import { members } from "./circles.ts";
import { ledgerEntries } from "./ledger.ts";
import { shifts } from "./shifts.ts";

/** Hands-on care a member logged, valued by the agreement once it is approved. */
export const careEntries = pgTable(
  "care_entries",
  {
    id: id(),
    circleId: circleId(),
    memberId: uuid("member_id").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    approved: boolean("approved").notNull().default(false),
    /** The care-credit entry that values it, once it is approved. */
    ledgerEntryId: uuid("ledger_entry_id"),
    /** The confirmed visit or drive this care time came from, when it came from one. A shift is credited once. */
    shiftId: uuid("shift_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "care_entries_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "care_entries_entry_fk", columns: [t.circleId, t.ledgerEntryId], foreignColumns: [ledgerEntries.circleId, ledgerEntries.id] }),
    foreignKey({ name: "care_entries_shift_fk", columns: [t.circleId, t.shiftId], foreignColumns: [shifts.circleId, shifts.id] }),
    unique("care_entries_one_per_shift").on(t.circleId, t.shiftId),
    check("care_entries_minutes", sql`${t.minutes} > 0 and ${t.minutes} <= 1440`),
    check("care_entries_entry_when_approved", sql`${t.ledgerEntryId} is null or ${t.approved}`),
    // A visit is credited only with its ledger entry, in one move.
    check("care_entries_shift_has_entry", sql`${t.shiftId} is null or (${t.approved} and ${t.ledgerEntryId} is not null)`),
  ],
);
