import { randomUUID } from "node:crypto";

import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";

import { E2E_DATABASE } from "./database-settings.ts";
import { IDENTITY_PROVIDER } from "./identity-provider.ts";

async function asAdmin<T>(work: (query: <R extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const admin = connect(readDatabaseConfig(JSON.parse(inherited) as Record<string, string>, ["admin"]), "admin");
  try {
    return await work(async (text, params = []) => (await admin.$client.query(text, params)).rows);
  } finally {
    await admin.$client.end();
  }
}

/**
 * Puts a bill Kin read from a letter, waiting for review, into the signed-in
 * person's own circle, as `add_letter` records one: the reading kept on the
 * document, a new payee in category other, and the bill at needs_review. The
 * reading itself is covered by the letters tests; these start from its result.
 */
export function seedLetterBill(sender: string, cents: number, dueOn: string): Promise<string> {
  return asAdmin(async (query) => {
    const [found] = await query<{ circle_id: string }>(
      `select m.circle_id from members m join circles c on c.id = m.circle_id
       where m.user_id = $1 and m.role = 'organizer' and m.status = 'active' and not c.demo and c.status = 'active' limit 1`,
      [IDENTITY_PROVIDER.person.sub],
    );
    if (!found) throw new Error("The signed-in person has no real circle to seed");
    const [documentId, payeeId, billId] = [randomUUID(), randomUUID(), randomUUID()];
    await query(`insert into documents (id, circle_id, kind, extraction, confidence) values ($1, $2, 'bill', $3::jsonb, 0.9)`, [documentId, found.circle_id, JSON.stringify({ kind: "bill", sender, amountCents: cents, dueOn, source: "rules_text" })]);
    await query(`insert into payees (id, circle_id, name, category, status) values ($1, $2, $3, 'other', 'new')`, [payeeId, found.circle_id, sender]);
    await query(`insert into bills (id, circle_id, payee_id, document_id, amount_cents, due_on, received_on, state) values ($1, $2, $3, $4, $5, $6, current_date, 'needs_review')`, [billId, found.circle_id, payeeId, documentId, cents, dueOn]);
    return billId;
  });
}

/** The payout an approved bill queued for Kin's worker: its execution and whether its outbox message waits. */
export function queuedPayoutOf(billId: string): Promise<{ readonly receiver: string | null; readonly state: string; readonly queued: boolean } | null> {
  return asAdmin(async (query) => {
    const [row] = await query<{ receiver: string | null; state: string; queued: boolean }>(
      `select e.receiver, e.state, exists (select 1 from outbox o where o.circle_id = e.circle_id and o.topic = 'payout.execute' and o.payload ->> 'executionId' = e.id::text) as queued
       from executions e join proposals p on p.circle_id = e.circle_id and p.id = e.proposal_id where p.bill_id = $1`,
      [billId],
    );
    return row ?? null;
  });
}
