import type { Session } from "@kin/auth";
import {
  CircleNotFoundError,
  acceptMyInvitations,
  asPerson,
  membershipsOf,
  provisionDemoCircle,
  readCircle,
  recordSignIn,
  type CircleSnapshot,
  type Membership,
} from "@kin/db";
import { cache } from "react";

import { databases } from "./database";
import type { Viewer } from "./viewer";

const UNIQUE_VIOLATION = "23505";

/**
 * The circle the viewer sees, read as them so row-level security decides
 * what comes back. A visitor sees their own demo circle, made on their first
 * visit. A person sees the first real circle they belong to, after joining
 * any that invited their verified address. `null` means a person is in no
 * circle yet. Read once per request.
 */
export const circleOf = cache(async (viewer: Viewer): Promise<CircleSnapshot | null> => {
  const seat = viewer.kind === "visitor" ? await demoSeat(viewer.userId) : await arrive(viewer);
  if (seat === null) return null;
  const read = (circleId: string) => asPerson(databases().app, viewer.userId, (tx) => readCircle(tx, { circleId, userId: viewer.userId, now: new Date() }));
  try {
    return await read(seat.circleId);
  } catch (error) {
    // The seat changed between the two reads, by "start again" in another tab. Read the new one, once.
    if (!(error instanceof CircleNotFoundError)) throw error;
    const [current] = await memberships(viewer.userId);
    return current ? read(current.circleId) : null;
  }
});

function memberships(userId: string): Promise<Membership[]> {
  return asPerson(databases().app, userId, (tx) => membershipsOf(tx, userId));
}

/** Records the person's visit, joins the circles that invited them, and returns their first. */
async function arrive(viewer: Extract<Viewer, { kind: "person" }>): Promise<Membership | null> {
  const [first] = await joinInvitedCircles(viewer.session);
  return first ?? null;
}

/** Records the person's visit, joins the circles that invited their verified address, and returns every seat they hold. */
export function joinInvitedCircles(session: Session): Promise<Membership[]> {
  return asPerson(databases().app, session.userId, async (tx) => {
    await recordSignIn(tx, { id: session.userId, email: session.email, emailVerified: session.emailVerified, name: session.name });
    await acceptMyInvitations(tx);
    return membershipsOf(tx, session.userId);
  });
}

/** The visitor's demo circle, or a fresh one when they have none. */
export async function demoSeat(visitorId: string): Promise<Membership | null> {
  const [seat] = await memberships(visitorId);
  return seat ?? (await joinDemo(visitorId));
}

/** Seats the visitor in a fresh copy of Rose's circle, its clock set to this moment. */
export async function joinDemo(visitorId: string): Promise<Membership | null> {
  const { provisioner } = databases();
  if (provisioner === null) return null;
  try {
    await provisionDemoCircle(provisioner, visitorId, new Date());
  } catch (error) {
    // Two first requests at once: the other one seated this visitor already,
    // and the database refused a second seat. Read the seat it made.
    if (!isUniqueViolation(error)) throw error;
  }
  const [seat] = await memberships(visitorId);
  return seat ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === UNIQUE_VIOLATION) return true;
  return "cause" in error && isUniqueViolation(error.cause);
}
