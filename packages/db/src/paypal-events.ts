import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Transaction } from "./connection.ts";
import { paypalEvents } from "./schema/index.ts";

export type PayPalEventState = (typeof paypalEvents.$inferSelect)["state"];

export type StoredEvent = { readonly id: string; readonly state: PayPalEventState };

/**
 * Keeps a webhook delivery exactly as it arrived, before anything reads it.
 * PayPal redelivers, so a second copy of the same event ID adds nothing and
 * returns the first copy's row. An event ID already filed under another
 * circle returns `null`: a genuine event replayed with a different circle in
 * its body must not be filed twice. Run inside `asService` for the circle.
 */
export async function storePayPalEvent(
  tx: Transaction,
  event: { readonly circleId: string; readonly eventId: string; readonly eventType: string; readonly rawBody: string; readonly headers: Readonly<Record<string, string>> },
): Promise<StoredEvent | null> {
  await tx
    .insert(paypalEvents)
    .values({ id: randomUUID(), circleId: event.circleId, eventId: event.eventId, eventType: event.eventType, rawBody: event.rawBody, headers: event.headers })
    .onConflictDoNothing({ target: paypalEvents.eventId });
  // Locked, so a second worker given the same event waits for the first.
  const [row] = await tx
    .select({ id: paypalEvents.id, state: paypalEvents.state })
    .from(paypalEvents)
    .where(and(eq(paypalEvents.eventId, event.eventId), eq(paypalEvents.circleId, event.circleId)))
    .for("update");
  return row ?? null;
}

/**
 * Moves an event on: `verified` once PayPal confirms the signature,
 * `rejected` when it does not, `processed` once applied, `failed` when it
 * verified but cannot be applied and needs a person.
 */
export async function settlePayPalEvent(tx: Transaction, id: string, state: Exclude<PayPalEventState, "received">): Promise<void> {
  const done = state === "processed" || state === "rejected" || state === "failed";
  await tx
    .update(paypalEvents)
    .set({ state, ...(done ? { processedAt: sql`now()` } : {}) })
    .where(eq(paypalEvents.id, id));
}
