import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { cents, circleId, createdAt, currency, id, periodCheck } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { direction, entryKind, entrySourceType } from "./enums.ts";
import { payees } from "./payees.ts";

/**
 * The accounts a circle's ledger posts to, by the money core's account code.
 * A scoped account names the member or payee it belongs to.
 */
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    circleId: circleId(),
    code: text("code").notNull(),
    memberId: uuid("member_id"),
    payeeId: uuid("payee_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "ledger_accounts_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "ledger_accounts_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "ledger_accounts_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    unique("ledger_accounts_circle_row").on(t.circleId, t.id),
    unique("ledger_accounts_one_per_code").on(t.circleId, t.code),
    check("ledger_accounts_code_shape", sql`${t.code} ~ '^[a-z_]+(:[A-Za-z0-9_-]+)?$'`),
    check("ledger_accounts_one_owner", sql`${t.memberId} is null or ${t.payeeId} is null`),
  ],
);

/**
 * One financial fact. Append-only: the database refuses an update or a
 * delete, and a correction is a new entry that reverses the original.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    circleId: circleId(),
    /** The order the ledger accepted entries in, within the whole database. */
    sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    kind: entryKind("kind").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    period: text("period").notNull(),
    description: text("description").notNull(),
    sourceType: entrySourceType("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    currency: currency(),
    simulated: boolean("simulated").notNull(),
    reverses: uuid("reverses"),
    /** The transaction that wrote the entry. Its lines must come in the same one. */
    createdTxid: bigint("created_txid", { mode: "number" }).notNull().default(sql`txid_current()`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "ledger_entries_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "ledger_entries_reverses_fk", columns: [t.circleId, t.reverses], foreignColumns: [t.circleId, t.id] }),
    unique("ledger_entries_circle_row").on(t.circleId, t.id),
    // The ledger's idempotency key: one entry per cause.
    unique("ledger_entries_one_per_source").on(t.circleId, t.sourceType, t.sourceId),
    // An entry can be reversed once.
    unique("ledger_entries_reversed_once").on(t.circleId, t.reverses),
    index("ledger_entries_period_idx").on(t.circleId, t.period),
    check("ledger_entries_period_shape", periodCheck("period")),
    check("ledger_entries_texts_present", sql`length(trim(${t.description})) > 0 and length(trim(${t.sourceId})) > 0`),
    check("ledger_entries_currency_code", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("ledger_entries_not_self_reversing", sql`${t.reverses} is null or ${t.reverses} <> ${t.id}`),
  ],
);

/** One side of an entry: an account, a direction and an amount above zero. */
export const ledgerLines = pgTable(
  "ledger_lines",
  {
    id: id(),
    circleId: circleId(),
    entryId: uuid("entry_id").notNull(),
    position: integer("position").notNull(),
    accountId: uuid("account_id").notNull(),
    direction: direction("direction").notNull(),
    cents: cents("cents").notNull(),
  },
  (t) => [
    foreignKey({ name: "ledger_lines_entry_fk", columns: [t.circleId, t.entryId], foreignColumns: [ledgerEntries.circleId, ledgerEntries.id] }),
    foreignKey({ name: "ledger_lines_account_fk", columns: [t.circleId, t.accountId], foreignColumns: [ledgerAccounts.circleId, ledgerAccounts.id] }),
    unique("ledger_lines_position").on(t.entryId, t.position),
    index("ledger_lines_account_idx").on(t.circleId, t.accountId),
    check("ledger_lines_cents_positive", sql`${t.cents} > 0`),
    check("ledger_lines_position_order", sql`${t.position} >= 0`),
  ],
);
