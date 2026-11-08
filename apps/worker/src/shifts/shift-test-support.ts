import { asService, recordFamilyWordByCall } from "@kin/db";
import { startedCall, type RealCircle, type TestDatabases } from "@kin/db/testing";

/** Raw SQL as the database's owner, to set up or read what no operation of the app reaches. */
export function adminQuery(db: TestDatabases, text: string, params: readonly unknown[] = []) {
  return db.admin.$client.query(text, [...params]);
}

/** The parent's yes on a call Kin placed, as the phone service records it: the shift is confirmed and `shift.settle` is queued. */
export async function parentSaysYes(db: TestDatabases, circle: RealCircle, shiftId: string): Promise<void> {
  const { circleId } = circle;
  const { callSid } = await startedCall(db, circle, shiftId);
  if (callSid === null) throw new Error("The call was not placed");
  await asService(db.service, circleId, (tx) => recordFamilyWordByCall(tx, { circleId, shiftId, callSid, answer: "yes" }));
}

/** Makes every call attempt of a circle look `minutes` older, as time passing would, by lifting the guard that holds an attempt fixed for the moment it takes. */
export async function ageCallAttempts(db: TestDatabases, circleId: string, minutes: number): Promise<void> {
  await adminQuery(db, "alter table shift_calls disable trigger call_fixed");
  try {
    await adminQuery(db, "update shift_calls set created_at = created_at - make_interval(mins => $2), ended_at = ended_at - make_interval(mins => $2) where circle_id = $1", [circleId, minutes]);
  } finally {
    await adminQuery(db, "alter table shift_calls enable trigger call_fixed");
  }
}

/** Makes the circle's waiting outbox messages of a topic available at once. */
export function releaseMessages(db: TestDatabases, circleId: string, topic: string) {
  return adminQuery(db, "update outbox set available_at = now() where circle_id = $1 and topic = $2 and sent_at is null", [circleId, topic]);
}
