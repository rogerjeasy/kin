import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { ShiftCallError } from "../shift-call-errors.ts";
import { recordCallPlaced, setParentCallSettings, startShiftCall, type ShiftCallToDial } from "../shift-calls.ts";
import { checkOutShift } from "../shifts.ts";
import { ShiftError } from "../shift-errors.ts";
import { asPerson, asService } from "../scope.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "./circles.ts";
import { deepMessage } from "./shifts.ts";
import type { TestDatabases } from "./databases.ts";

/** The number every test call dials. It is not a real one. */
export const PARENT_PHONE = "+15555550142";

export type RealCircle = VisitorCircle & {
  /** The caregiver Amara and the parent Rose, seated as signed-in visitors. */
  readonly amara: string;
  readonly rose: string;
};

/**
 * A copy of Rose's circle made real: no demo flag and no standing clock, so the
 * circle's moment is the database's own and a call may be placed for it. Its
 * timezone is UTC, so a test can place quiet hours around the database's now.
 */
export async function realCircle(db: TestDatabases): Promise<RealCircle> {
  const circle = await visitorWithCircle(db);
  // A demo visitor can only be seated in a demo circle, so everyone is seated before it is made real.
  const [amara, rose] = [await seatPerson(db, circle.circleId, circle.members.amara), await seatPerson(db, circle.circleId, circle.members.rose)];
  await db.admin.execute(sql`update circles set demo = false, clock_at = null, timezone = 'UTC' where id = ${circle.circleId}`);
  return { ...circle, amara, rose };
}

/** Runs `work` as the owner with the triggers off, to place a row in a state no operation of the app reaches (a visit that began hours ago). */
export async function withoutTriggers<T>(db: TestDatabases, work: (run: (query: ReturnType<typeof sql>) => Promise<unknown>) => Promise<T>): Promise<T> {
  return db.admin.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    return work((query) => tx.execute(query));
  });
}

/**
 * Puts a caregiver's care agreements at `rateCentsPerHour`, for a test that
 * pays at another rate than the seeded one to reach a figure it needs. Kin
 * pays only at the rate an agreement states, and an agreement's terms never
 * change once written, so the trigger that fixes them is stepped around here,
 * as nowhere in the app.
 */
export function agreeAtRate(db: TestDatabases, circleId: string, payeeId: string, rateCentsPerHour: number): Promise<void> {
  return withoutTriggers(db, async (run) => {
    await run(sql`update care_agreements set rate_cents_per_hour = ${rateCentsPerHour} where circle_id = ${circleId} and payee_id = ${payeeId}`);
  });
}

/**
 * An aide's shift for Amara on a real circle, planned around the database's now and already checked in
 * `inMinutesAgo` minutes ago, to the whole second, as the database's own taps are, so a visit lasts whole minutes.
 */
export async function openAideShift(db: TestDatabases, circle: RealCircle, inMinutesAgo = 120): Promise<string> {
  const id = randomUUID();
  await db.admin.execute(sql`insert into shifts (id, circle_id, kind, member_id, payee_id, starts_at, ends_at, state, checked_in_at, created_by)
    values (${id}, ${circle.circleId}, 'aide', ${circle.members.amara}, ${circle.payees.amara},
            now() - make_interval(mins => ${inMinutesAgo + 5}), now() + interval '2 hours', 'checked_in', date_trunc('second', now()) - make_interval(mins => ${inMinutesAgo}), ${circle.members.elena})`);
  return id;
}

/** The parent switches the call on, with consent, as herself. */
export function enableCalls(db: TestDatabases, circle: RealCircle, phone = PARENT_PHONE): Promise<void> {
  return asPerson(db.app, circle.rose, (tx) => setParentCallSettings(tx, { circleId: circle.circleId, phone, enabled: true, consent: true }));
}

/** Puts the circle's quiet hours (UTC) around the database's now, or well away from it. */
export async function setQuietHours(db: TestDatabases, circleId: string, now: "inside" | "outside"): Promise<void> {
  const [from, to] = now === "inside" ? ["-1 hour", "+1 hour"] : ["+3 hours", "+5 hours"];
  await db.admin.execute(sql`update parent_call_settings
    set quiet_start = ((now() at time zone 'UTC') + ${from}::interval)::time, quiet_end = ((now() at time zone 'UTC') + ${to}::interval)::time
    where circle_id = ${circleId}`);
}

/** The outbox topics queued for a circle, oldest first, with their payloads. */
export async function queued(db: TestDatabases, circleId: string, topic: string): Promise<{ payload: unknown; availableAt: Date }[]> {
  const rows = await db.admin.execute<{ payload: unknown; available_at: Date }>(sql`select payload, available_at from outbox where circle_id = ${circleId} and topic = ${topic} order by created_at, id`);
  return rows.rows.map((row) => ({ payload: row.payload, availableAt: new Date(row.available_at) }));
}

/** The typed reason a promise was refused for, or the database's own message for anything untyped, or "no error". */
export async function reasonOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof ShiftError || error instanceof ShiftCallError ? error.reason : deepMessage(error);
  }
}

/** A real circle whose parent has switched the call on and whose aide has just left a visit that began two hours ago: the shift waits for the family's word. */
export async function waitingForWord(db: TestDatabases): Promise<RealCircle & { readonly shiftId: string }> {
  const circle = await realCircle(db);
  await enableCalls(db, circle);
  await setQuietHours(db, circle.circleId, "outside");
  const shiftId = await openAideShift(db, circle);
  await asPerson(db.app, circle.amara, (tx) => checkOutShift(tx, { circleId: circle.circleId, shiftId, now: new Date() }));
  return { ...circle, shiftId };
}

/**
 * Kin's call started for a waiting shift, as the worker does it: the attempt is queued and, unless told not to,
 * the telephony provider has taken it and given it an ID (made up here: `callSid` is `null` when not placed).
 */
export async function startedCall(
  db: TestDatabases,
  circle: RealCircle,
  shiftId: string,
  options: { readonly place?: boolean } = {},
): Promise<{ readonly call: ShiftCallToDial; readonly callSid: string | null }> {
  const { circleId } = circle;
  return asService(db.service, circleId, async (tx) => {
    const call = await startShiftCall(tx, { circleId, shiftId });
    if (call.kind !== "dial") throw new Error(`The call was refused: ${call.reason}`);
    if (options.place === false) return { call, callSid: null };
    const callSid = `CA${randomUUID().replaceAll("-", "")}`;
    await recordCallPlaced(tx, { circleId, shiftId, callId: call.callId, callSid });
    return { call, callSid };
  });
}
