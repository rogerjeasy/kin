import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";

import { E2E_DATABASE } from "./database-settings.ts";

/**
 * The link Kin's worker would email for the newest invitation to `email`, read
 * from the outbox as the worker reads it. No worker runs in the end-to-end
 * tests, so this is how a test opens the page the email leads to.
 */
export async function invitationLinkFor(email: string): Promise<string> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const admin = connect(readDatabaseConfig(JSON.parse(inherited) as Record<string, string>, ["admin"]), "admin");
  try {
    const found = await admin.$client.query<{ token: string | null }>(
      `select o.payload ->> 'token' as token from outbox o join invitations i on i.id = (o.payload ->> 'invitationId')::uuid
       where o.topic = 'invitation.email' and i.email = $1 order by o.created_at desc limit 1`,
      [email],
    );
    const token = found.rows[0]?.token;
    if (!token) throw new Error("No invitation email is queued for that address");
    return `/en/join/${token}`;
  } finally {
    await admin.$client.end();
  }
}
