import { dayPart, type ShiftCallState } from "@kin/domain";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { circles, members, shiftCalls, shifts } from "./schema/index.ts";
import { recordCallPlaced } from "./shift-calls.ts";

/**
 * Reads of Kin's calls to the parent that its two services need beyond the
 * operations in `shift-calls.ts`: the worker, to find an attempt whose report
 * was lost, and the phone service, to tie a webhook to an attempt and to load
 * what the call says. Both run as Kin's service, inside `asService`, so the
 * database shows them only the circle in scope; neither reads the parent's number.
 */

/** An attempt that may still bring a word, as the worker needs it to give up on one that went quiet. */
export type ActiveShiftCall = { readonly attempt: number; readonly state: ShiftCallState; readonly callSid: string | null; readonly queuedAt: Date };

/**
 * The shift's attempt that has been active for more than `staleMinutes`: it was queued, dialed or answered
 * and no report of how it ended ever arrived. `null` when there is none. The age is the database's own clock.
 */
export async function findStaleShiftCall(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly staleMinutes: number }): Promise<ActiveShiftCall | null> {
  const [row] = await tx
    .select({ attempt: shiftCalls.attempt, state: shiftCalls.state, callSid: shiftCalls.callSid, queuedAt: shiftCalls.createdAt })
    .from(shiftCalls)
    .where(
      and(
        eq(shiftCalls.circleId, input.circleId),
        eq(shiftCalls.shiftId, input.shiftId),
        inArray(shiftCalls.state, ["queued", "calling", "answered"]),
        lt(shiftCalls.createdAt, sql`now() - make_interval(mins => ${input.staleMinutes})`),
      ),
    )
    .orderBy(asc(shiftCalls.attempt))
    .limit(1);
  // Safe: a check constraint holds a call's state to the domain's list.
  return row ? { ...row, state: row.state as ShiftCallState } : null;
}

/** What a webhook for a shift call needs, loaded from the record: never from the request or the token. */
export type ShiftCallWebhookRecord = {
  readonly state: ShiftCallState;
  readonly caregiverName: string;
  readonly dayPart: ReturnType<typeof dayPart>;
  /** The family member who set the shift up, or `null` for "the family". */
  readonly contactName: string | null;
};

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/**
 * Ties a webhook to the attempt it is about, and loads the names and the part of the day the call speaks.
 * The attempt is the one the (verified) token names; the request's `callSid` must be the one recorded on it.
 * Twilio can post its first webhook before the worker has recorded the call's ID, so an attempt still waiting
 * for its ID (`queued`) takes this one, by the same operation the worker uses (`recordCallPlaced`), which
 * changes nothing if said again. Returns `null` for a call that is not Kin's for this shift and attempt:
 * another ID is recorded on it, this ID belongs to another call, the attempt does not exist, or it was never placed.
 */
export async function openShiftCallForWebhook(
  tx: Transaction,
  input: { readonly circleId: string; readonly shiftId: string; readonly attempt: number; readonly callSid: string },
): Promise<ShiftCallWebhookRecord | null> {
  const { circleId, shiftId, attempt, callSid } = input;
  const [call] = await tx
    .select({ id: shiftCalls.id, state: shiftCalls.state, callSid: shiftCalls.callSid })
    .from(shiftCalls)
    .where(and(eq(shiftCalls.circleId, circleId), eq(shiftCalls.shiftId, shiftId), eq(shiftCalls.attempt, attempt)));
  if (!call || (call.callSid !== null && call.callSid !== callSid)) return null;
  // Safe: a check constraint holds a call's state to the domain's list.
  let state = call.state as ShiftCallState;
  if (call.callSid === null) {
    if (state !== "queued") return null;
    const [taken] = await tx.select({ id: shiftCalls.id }).from(shiftCalls).where(and(eq(shiftCalls.circleId, circleId), eq(shiftCalls.callSid, callSid)));
    if (taken) return null;
    await recordCallPlaced(tx, { circleId, shiftId, callId: call.id, callSid });
    state = "calling";
  }
  const record = await readCallFacts(tx, circleId, shiftId);
  return record === null ? null : { state, ...record };
}

async function readCallFacts(tx: Transaction, circleId: string, shiftId: string): Promise<Omit<ShiftCallWebhookRecord, "state"> | null> {
  const [shift] = await tx
    .select({ memberId: shifts.memberId, createdBy: shifts.createdBy, startedAt: sql<Date>`coalesce(${shifts.checkedInAt}, ${shifts.startsAt})`, timezone: circles.timezone })
    .from(shifts)
    .innerJoin(circles, eq(circles.id, shifts.circleId))
    .where(and(eq(shifts.circleId, circleId), eq(shifts.id, shiftId)));
  if (!shift) return null;
  const named = await tx
    .select({ id: members.id, name: members.displayName, role: members.role, status: members.status })
    .from(members)
    .where(and(eq(members.circleId, circleId), inArray(members.id, [shift.memberId, shift.createdBy])));
  const caregiver = named.find((member) => member.id === shift.memberId);
  const creator = named.find((member) => member.id === shift.createdBy);
  if (!caregiver || firstName(caregiver.name) === "") return null;
  const family = creator !== undefined && creator.id !== caregiver.id && creator.status === "active" && (creator.role === "organizer" || creator.role === "contributor");
  return {
    caregiverName: firstName(caregiver.name),
    dayPart: dayPart(new Date(shift.startedAt), shift.timezone),
    contactName: family ? firstName(creator.name) || null : null,
  };
}

