import type { CircleRole } from "@kin/domain";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "../connection.ts";
import { provisionDemoCircle, type ProvisionedCircle } from "../demo/provision.ts";
import { createDemoVisitor, recordSignIn } from "../people.ts";
import { members } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import type { TestDatabases } from "./databases.ts";

/** A person who has signed in once, so their user row exists. */
export async function signedIn(app: Database, name = "Visitor", email?: string): Promise<string> {
  const id = randomUUID();
  await asPerson(app, id, (tx) => recordSignIn(tx, { id, email: email ?? `${id}@example.com`, emailVerified: true, name }));
  return id;
}

export type VisitorCircle = ProvisionedCircle & { readonly userId: string };

/** A demo visitor and the demo circle provisioned for them, seated as the organizer. */
export async function visitorWithCircle(db: TestDatabases): Promise<VisitorCircle> {
  const userId = await createDemoVisitor(db.app);
  return { ...(await provisionDemoCircle(db.provisioner, userId)), userId };
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
