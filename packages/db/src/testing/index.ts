import type { CircleSnapshot } from "../circle-snapshot.ts";
import { readCircle } from "../read-circle.ts";
import { eq, sql, type SQL } from "drizzle-orm";

import { monthlyShares, paypalEvents } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import type { TestDatabases } from "./databases.ts";

export { testDatabases } from "./databases.ts";
export type { TestDatabases } from "./databases.ts";
export { addMember, seatPerson, signedIn, visitorWithCircle } from "./circles.ts";
export type { VisitorCircle } from "./circles.ts";
export { agreeWithoutCare, confirmedVisit } from "./visits.ts";
export type { ConfirmedVisit } from "./visits.ts";
export { PARENT_PHONE, enableCalls, openAideShift, queued, realCircle, setQuietHours, startedCall, waitingForWord, withoutTriggers } from "./real-shifts.ts";
export type { RealCircle } from "./real-shifts.ts";

/** The circle as `userId` sees it, read the way the web app reads it. */
export function snapshotFor(db: TestDatabases, userId: string, circleId: string): Promise<CircleSnapshot> {
  return asPerson(db.app, userId, (tx) => readCircle(tx, { circleId, userId, now: new Date() }));
}

/** The PayPal events stored for a circle, by PayPal's event ID and state, read as the service. */
export async function paypalEventStates(db: TestDatabases, circleId: string): Promise<{ eventId: string; state: string }[]> {
  return asService(db.service, circleId, (tx) =>
    tx.select({ eventId: paypalEvents.eventId, state: paypalEvents.state }).from(paypalEvents).where(eq(paypalEvents.circleId, circleId)),
  );
}

/**
 * Rows of a query run as Kin's service in one circle's scope, so row-level
 * security still applies. `$1`, `$2`... are bound to `params`, never spliced in.
 */
export async function serviceRows(db: TestDatabases, circleId: string, text: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
  const parts = text.split(/\$(\d+)/);
  const query = sql.join(
    parts.map((part, index): SQL => (index % 2 === 0 ? sql.raw(part) : sql`${params[Number(part) - 1]}`)),
    sql.raw(""),
  );
  return asService(db.service, circleId, async (tx) => (await tx.execute<Record<string, unknown>>(query)).rows);
}

/** Runs a query as a person through the app's identity, to show what it may not do. */
export async function personQuery(db: TestDatabases, userId: string, text: string): Promise<unknown> {
  return asPerson(db.app, userId, (tx) => tx.execute(sql.raw(text)));
}


/**
 * Writes a monthly share as the service, in any state. A person may start only
 * a simulated share in a demo circle, so a test that needs a share with PayPal
 * behind it, or one that has already moved on, writes it here.
 */
export async function insertShare(
  db: TestDatabases,
  circleId: string,
  share: { id: string; memberId: string; cents: number; state?: "approval_pending" | "active" | "paused" | "cancelled"; paypalSubscriptionId?: string },
): Promise<void> {
  await asService(db.service, circleId, (tx) =>
    tx.insert(monthlyShares).values({
      id: share.id,
      circleId,
      memberId: share.memberId,
      amountCents: share.cents,
      currency: "USD",
      state: share.state ?? (share.paypalSubscriptionId === undefined ? "active" : "approval_pending"),
      simulated: share.paypalSubscriptionId === undefined,
      paypalSubscriptionId: share.paypalSubscriptionId ?? null,
      approvalUrl: share.paypalSubscriptionId === undefined ? null : "https://www.sandbox.paypal.com/approve",
    }),
  );
}

/**
 * Ends the demo's seeded mandate, so a test about the family's own approval
 * starts from a refill that waits for a yes. Done as the owner: no role of
 * Kin's may end a mandate except through its operation.
 */
export async function endMandates(db: TestDatabases, circleId: string): Promise<void> {
  await db.admin.execute(sql`update mandates set status = 'revoked', ended_at = now() where circle_id = ${circleId}`);
}

/** Pauses the demo's seeded mandate, as the owner, for the same reason. */
export async function pauseMandates(db: TestDatabases, circleId: string): Promise<void> {
  await db.admin.execute(sql`update mandates set status = 'paused' where circle_id = ${circleId}`);
}

/**
 * Runs one statement as the database's owner, to put a row in a state no operation of the app reaches (a person whose number
 * was confirmed, a message already sent). `$1`, `$2`... are bound to `params`. Only tests use it.
 */
export async function adminRun(db: TestDatabases, text: string, params: readonly unknown[] = []): Promise<void> {
  await db.admin.$client.query(text, [...params]);
}
