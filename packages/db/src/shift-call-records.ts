import type { ShiftCallState } from "@kin/domain";
import { and, asc, eq } from "drizzle-orm";

import type { ParentCallSettingsRecord } from "./circle-snapshot.ts";
import type { Transaction } from "./connection.ts";
import { parentCallSettings, shiftCalls } from "./schema/index.ts";

/**
 * Whether Kin phones the parent, as the person looking may see it: the parent
 * and the organizer, and nobody else. The number itself is never read: the
 * database grants no role of the web app that column, so the query below could
 * not select it if it tried. Run inside `asPerson`.
 */
export async function readParentCallSettings(tx: Transaction, circleId: string): Promise<ParentCallSettingsRecord | null> {
  const [row] = await tx
    .select({
      memberId: parentCallSettings.memberId,
      enabled: parentCallSettings.enabled,
      locale: parentCallSettings.locale,
      consentedBy: parentCallSettings.consentedBy,
      consentedAt: parentCallSettings.consentedAt,
      quietStart: parentCallSettings.quietStart,
      quietEnd: parentCallSettings.quietEnd,
    })
    .from(parentCallSettings)
    .where(eq(parentCallSettings.circleId, circleId));
  return row ?? null;
}

/**
 * How Kin's latest call about each shift went, by shift. Those who see the
 * circle's money read it; a caregiver is given none, so the map is empty for them.
 */
export async function readCallStates(tx: Transaction, circleId: string): Promise<ReadonlyMap<string, ShiftCallState>> {
  const rows = await tx
    .select({ shiftId: shiftCalls.shiftId, state: shiftCalls.state })
    .from(shiftCalls)
    .where(and(eq(shiftCalls.circleId, circleId)))
    .orderBy(asc(shiftCalls.attempt));
  // Ordered by attempt, so the last one set for a shift is its latest.
  // Safe: a check constraint holds a call's state to the domain's list.
  return new Map(rows.map((row) => [row.shiftId, row.state as ShiftCallState]));
}
