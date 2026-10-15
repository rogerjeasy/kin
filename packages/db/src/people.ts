import type { CircleRole, ParentLevel } from "@kin/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database, Transaction } from "./connection.ts";
import { circles, members, users } from "./schema/index.ts";
import { asPerson } from "./scope.ts";
import { DEMO_VISITOR_PREFIX } from "./values.ts";

export type SignedInPerson = { readonly id: string; readonly email: string; readonly emailVerified: boolean; readonly name: string };

/** Keeps the person's own row current each time they arrive. Run inside `asPerson`. */
export async function recordSignIn(tx: Transaction, person: SignedInPerson): Promise<void> {
  await tx
    .insert(users)
    .values({ id: person.id, kind: "person", email: person.email, emailVerified: person.emailVerified, name: person.name })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: person.email, emailVerified: person.emailVerified, name: person.name, lastSeenAt: sql`now()` },
    });
}

/**
 * Creates the anonymous user behind a press of the Demo button, so each
 * visitor is a row Kin can count, with no account and no personal details.
 */
export async function createDemoVisitor(db: Database): Promise<string> {
  const token = randomUUID();
  const id = `${DEMO_VISITOR_PREFIX}${token}`;
  await asPerson(db, id, (tx) =>
    tx.insert(users).values({ id, kind: "demo_visitor", email: `visitor-${token}@demo.invalid`, name: "Demo visitor" }),
  );
  return id;
}

export type Membership = {
  readonly circleId: string;
  readonly circleName: string;
  readonly memberId: string;
  readonly role: CircleRole;
  readonly demo: boolean;
  readonly demoSeat: boolean;
};

/** The active circles the person belongs to, oldest seat first. Run inside `asPerson`. */
export async function membershipsOf(tx: Transaction, userId: string): Promise<Membership[]> {
  return tx
    .select({
      circleId: circles.id,
      circleName: circles.name,
      memberId: members.id,
      role: members.role,
      demo: circles.demo,
      demoSeat: members.demoSeat,
    })
    .from(members)
    .innerJoin(circles, eq(circles.id, members.circleId))
    .where(and(eq(members.userId, userId), eq(members.status, "active"), eq(circles.status, "active")))
    .orderBy(asc(members.joinedAt), asc(members.id));
}

/**
 * Archives the visitor's own demo circle, so a fresh one can take its place.
 * The database allows this only for the circle in which they hold the demo
 * seat. Nothing is deleted: the ledger stays as it was.
 */
export async function leaveDemoCircle(tx: Transaction, circleId: string): Promise<void> {
  await tx.execute(sql`select kin_private.leave_demo_circle(${circleId})`);
}

/** Moves the visitor into another persona's empty seat in their demo circle. */
export async function takeDemoSeat(tx: Transaction, circleId: string, memberId: string): Promise<void> {
  await tx.execute(sql`select kin_private.take_demo_seat(${circleId}, ${memberId})`);
}

export type NewCircle = {
  readonly name: string;
  readonly timezone: string;
  readonly currency: string;
  readonly parentName: string;
  readonly parentLevel: ParentLevel;
  /** How the organizer is related to the parent, in their own words. */
  readonly relationship: string | null;
};

/** Starts a real circle with the person as organizer and the parent as its first member. */
export async function createCircle(tx: Transaction, circle: NewCircle): Promise<string> {
  const result = await tx.execute<{ id: string }>(
    sql`select kin_private.create_circle(${circle.name}, ${circle.timezone}, ${circle.currency}, ${circle.parentName}, ${circle.parentLevel}::parent_level, ${circle.relationship}) as id`,
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("The database made no circle");
  return id;
}

/** Joins the circles that invited the person's verified address. Returns how many. */
export async function acceptMyInvitations(tx: Transaction): Promise<number> {
  const result = await tx.execute<{ joined: number }>(sql`select kin_private.accept_my_invitations() as joined`);
  return Number(result.rows[0]?.joined ?? 0);
}
