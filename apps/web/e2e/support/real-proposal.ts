import { randomUUID } from "node:crypto";

import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";

import { E2E_DATABASE } from "./database-settings.ts";
import { IDENTITY_PROVIDER } from "./identity-provider.ts";

/**
 * Puts a payment that waits for the organizer's yes into the signed-in
 * person's own circle, as Kin's service would raise one. Real circles have no
 * screen that raises a proposal yet, so the tests of answering one start here.
 */
export async function seedRealProposal(payee: string, cents: number): Promise<string> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const admin = connect(readDatabaseConfig(JSON.parse(inherited) as Record<string, string>, ["admin"]), "admin");
  try {
    const db = admin.$client;
    const found = await db.query<{ circle_id: string }>(
      `select m.circle_id from members m join circles c on c.id = m.circle_id
       where m.user_id = $1 and m.role = 'organizer' and m.status = 'active' and not c.demo and c.status = 'active' limit 1`,
      [IDENTITY_PROVIDER.person.sub],
    );
    const circleId = found.rows[0]?.circle_id;
    if (!circleId) throw new Error("The signed-in person has no real circle to seed");
    const payeeId = randomUUID();
    const proposalId = randomUUID();
    const expiresAt = new Date(Date.now() + 72 * 3_600_000);
    const plan = { outcome: "needs_approval", slots: [{ reason: "organizer", roles: ["organizer"] }], payeeMemberId: null, announceToCircle: false, expiresAt: expiresAt.toISOString() };
    await db.query(`insert into payees (id, circle_id, name, category, status) values ($1, $2, $3, 'utilities', 'approved')`, [payeeId, circleId, payee]);
    await db.query(
      `insert into proposals (id, circle_id, kind, cents, payee_id, purpose, raised_at, state, expires_at, agreement_version, plan)
       values ($1, $2, 'bill_payment', $3, $4, 'utility_bill', now(), 'pending_approval', $5, 1, $6::jsonb)`,
      [proposalId, circleId, cents, payeeId, expiresAt, JSON.stringify(plan)],
    );
    return proposalId;
  } finally {
    await admin.$client.end();
  }
}
