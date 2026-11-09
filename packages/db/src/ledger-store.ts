import {
  appendEntries,
  describeAccount,
  openLedger,
  restoreEntry,
  type AccountCode,
  type Ledger,
  type LedgerEntry,
} from "@kin/domain";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Transaction } from "./connection.ts";
import { ledgerAccounts, ledgerEntries, ledgerLines } from "./schema/index.ts";

/** A circle's account codes and the IDs of their rows. */
export type AccountIds = Map<string, string>;

/** The member or payee a scoped account belongs to, read from its code. */
function ownerOf(code: AccountCode): { memberId: string | null; payeeId: string | null } {
  const { family, subject } = describeAccount(code);
  if (family === "member" || family === "care_credit") return { memberId: subject, payeeId: null };
  if (family === "payable") return { memberId: null, payeeId: subject };
  return { memberId: null, payeeId: null };
}

/** The circle's account rows that exist so far, by code. */
export async function readAccountIds(tx: Transaction, circleId: string): Promise<AccountIds> {
  const rows = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.circleId, circleId));
  return new Map(rows.map((row) => [row.code, row.id]));
}

/**
 * Writes entries the money core built, each with its lines, in the caller's
 * transaction. Accounts not yet in `accounts` are created and added to it.
 * The database checks again that every entry balances when the transaction
 * commits, and refuses any later change.
 */
export async function writeEntries(tx: Transaction, entries: readonly LedgerEntry[], accounts: AccountIds): Promise<void> {
  for (const entry of entries) {
    const newAccounts = entry.lines
      .map((line) => line.account)
      .filter((code, index, codes) => !accounts.has(code) && codes.indexOf(code) === index)
      .map((code) => ({ id: randomUUID(), circleId: entry.circleId, code, ...ownerOf(code) }));
    if (newAccounts.length > 0) {
      await tx.insert(ledgerAccounts).values(newAccounts);
      for (const account of newAccounts) accounts.set(account.code, account.id);
    }
    await tx.insert(ledgerEntries).values({
      id: entry.id,
      circleId: entry.circleId,
      kind: entry.kind,
      occurredOn: entry.occurredOn,
      period: entry.period,
      description: entry.description,
      sourceType: entry.source.type,
      sourceId: entry.source.id,
      currency: entry.currency,
      simulated: entry.simulated,
      reverses: entry.reverses,
    });
    await tx.insert(ledgerLines).values(
      entry.lines.map((line, position) => ({
        id: randomUUID(),
        circleId: entry.circleId,
        entryId: entry.id,
        position,
        accountId: accountId(accounts, line.account),
        direction: line.direction,
        cents: line.cents,
      })),
    );
  }
}

function accountId(accounts: AccountIds, code: string): string {
  const id = accounts.get(code);
  if (id === undefined) throw new Error(`No ledger account row for ${code}`);
  return id;
}

/**
 * The circle's ledger as the money core reads it, in the order the database
 * accepted the entries. Every entry is checked again on the way out.
 */
export async function readLedger(tx: Transaction, circle: { id: string; currency: string }): Promise<Ledger> {
  // One query at a time: a transaction is one connection, and pg will refuse queries sent over it at once.
  const entryRows = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.circleId, circle.id)).orderBy(asc(ledgerEntries.sequence));
  const lineRows = await tx
    .select({ entryId: ledgerLines.entryId, code: ledgerAccounts.code, direction: ledgerLines.direction, cents: ledgerLines.cents })
    .from(ledgerLines)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerLines.accountId))
    .where(eq(ledgerLines.circleId, circle.id))
    .orderBy(asc(ledgerLines.entryId), asc(ledgerLines.position));
  const linesByEntry = Map.groupBy(lineRows, (line) => line.entryId);
  const entries = entryRows.map((row) =>
    restoreEntry({
      id: row.id,
      circleId: row.circleId,
      kind: row.kind,
      occurredOn: row.occurredOn,
      period: row.period,
      description: row.description,
      source: { type: row.sourceType, id: row.sourceId },
      currency: row.currency,
      simulated: row.simulated,
      reverses: row.reverses,
      lines: (linesByEntry.get(row.id) ?? []).map((line) => ({
        // Safe: the code was checked against the ledger's accounts when it was written.
        account: line.code as AccountCode,
        direction: line.direction,
        cents: line.cents,
      })),
    }),
  );
  return appendEntries(openLedger(circle.id, circle.currency), entries);
}
