import { rosesMonth, type CircleRole } from "@kin/domain";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "../connection.ts";
import { provisionDemoCircle, type ProvisionedCircle } from "../demo/provision.ts";
import { ROSES_CIRCLE } from "../demo/roses-circle.ts";
import { PURSE_SEED_ENTRIES } from "../demo/roses-purse.ts";
import { createDemoVisitor, recordSignIn } from "../people.ts";
import { members } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import type { TestDatabases } from "./databases.ts";

/** The entries a fresh demo circle's ledger holds: Rose's month, and the week's float into her Purse. */
export const DEMO_LEDGER_ENTRIES = rosesMonth.ledger.entries.length + PURSE_SEED_ENTRIES;

/** A person who has signed in once, so their user row exists. */
export async function signedIn(app: Database, name = "Visitor", email?: string): Promise<string> {
  const id = randomUUID();
  await asPerson(app, id, (tx) => recordSignIn(tx, { id, email: email ?? `${id}@example.com`, emailVerified: true, name }));
  return id;
}

export type VisitorCircle = ProvisionedCircle & { readonly userId: string };

/**
 * A demo visitor and the demo circle provisioned for them, seated as the
 * organizer. Pressed at the template's own clock unless `now` says otherwise,
 * so the tests' dates never depend on the day they run.
 */
export async function visitorWithCircle(db: TestDatabases, now: Date = ROSES_CIRCLE.clockAt): Promise<VisitorCircle> {
  const userId = await createDemoVisitor(db.app);
  return { ...(await provisionDemoCircle(db.provisioner, userId, now)), userId };
}

/** Seats another demo visitor in an existing member's seat of a demo circle. */
export async function seatPerson(db: TestDatabases, circleId: string, memberId: string): Promise<string> {
  const userId = await createDemoVisitor(db.app);
  await asService(db.service, circleId, (tx) => tx.update(members).set({ userId }).where(eq(members.id, memberId)));
  return userId;
}

/** Adds a demo visitor to a demo circle in a role it does not have yet. */
export async function addMember(db: TestDatabases, circleId: string, role: CircleRole): Promise<{ userId: string; memberId: string }> {
  const userId = await createDemoVisitor(db.app);
  const memberId = randomUUID();
  await asService(db.service, circleId, (tx) =>
    tx.insert(members).values({ id: memberId, circleId, userId, displayName: `A ${role}`, role }),
  );
  return { userId, memberId };
}
