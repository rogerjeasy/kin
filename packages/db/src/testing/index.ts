import type { CircleSnapshot } from "../circle-snapshot.ts";
import { readCircle } from "../read-circle.ts";
import { asPerson } from "../scope.ts";
import type { TestDatabases } from "./databases.ts";

export { testDatabases } from "./databases.ts";
export type { TestDatabases } from "./databases.ts";
export { addMember, seatPerson, signedIn, visitorWithCircle } from "./circles.ts";
export type { VisitorCircle } from "./circles.ts";

/** The circle as `userId` sees it, read the way the web app reads it. */
export function snapshotFor(db: TestDatabases, userId: string, circleId: string): Promise<CircleSnapshot> {
  return asPerson(db.app, userId, (tx) => readCircle(tx, { circleId, userId, now: new Date() }));
}
