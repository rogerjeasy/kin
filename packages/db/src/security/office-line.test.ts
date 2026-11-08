import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { readLineRecord, recordLineCall, type LineCallInput } from "../office-calls.ts";
import { asPerson, asService } from "../scope.ts";
import { visitorWithCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();

let sids = 0;
const nextSid = (): string => `CA${String(++sids).padStart(32, "0")}`;

const call = (circleId: string, patch: Partial<LineCallInput> = {}): LineCallInput => ({
  circleId,
  callSid: nextSid(),
  callerNumber: "+15555550199",
  callerName: "Mike",
  organization: "Harbor Gas Services",
  claimedCents: 30000,
  purpose: "Gas",
  reference: null,
  transcript: [{ from: "kin", text: "Hello" }],
  pressureSignals: ["urgency"],
  payeeId: null,
  foundEntryId: null,
  verdict: "no_match",
  topic: "falseDemand",
  spoken: "A caller asked for money.",
  claim: "Harbor Gas Services: Gas",
  ...patch,
});

describe("the office line's service operation (migration 0027)", () => {
  it("records a phone call as a real call, with its claim check, the family's alerts and an audit entry by the service", async () => {
    const circle = await visitorWithCircle(db);
    const recorded = await asService(db.service, circle.circleId, (tx) => recordLineCall(tx, call(circle.circleId)));
    await asService(db.service, circle.circleId, async (tx) => {
      const calls = await tx.execute<{ simulated: boolean; claim_check_id: string }>(sql`select simulated, claim_check_id from office_calls where id = ${recorded.callId}`);
      expect(calls.rows).toEqual([{ simulated: false, claim_check_id: recorded.claimCheckId }]);
      const alerts = await tx.execute<{ n: number }>(sql`select count(*)::int as n from narrations where claim_check_id = ${recorded.claimCheckId} and state = 'queued'`);
      expect(alerts.rows[0]?.n).toBeGreaterThan(0);
      const audit = await tx.execute<{ actor: string; origin: string; member_id: string | null }>(
        sql`select actor::text, origin, member_id from audit_log where subject_id = ${recorded.callId} and action = 'office_call.recorded'`,
      );
      expect(audit.rows).toEqual([{ actor: "service", origin: "phone", member_id: null }]);
    });
  });

  it("refuses to record into any circle but the one the service is scoped to, and records nothing", async () => {
    const mine = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    // The wrapper turns the database's refusal into a LetterError("refused").
    await expect(asService(db.service, mine.circleId, (tx) => recordLineCall(tx, call(other.circleId)))).rejects.toMatchObject({ reason: "refused" });
    expect(await asService(db.service, other.circleId, (tx) => countIn(tx, "office_calls", other.circleId))).toBe(0);
    expect(await asService(db.service, mine.circleId, (tx) => countIn(tx, "office_calls", mine.circleId))).toBe(0);
  });

  it("is refused with no circle in scope, and for a closed circle", async () => {
    const circle = await visitorWithCircle(db);
    const unscoped = db.service.transaction((tx) => recordLineCall(tx, call(circle.circleId)));
    await expect(unscoped).rejects.toThrow();
    await asService(db.admin, circle.circleId, (tx) => tx.execute(sql`update circles set status = 'archived' where id = ${circle.circleId}`));
    await expect(asService(db.service, circle.circleId, (tx) => recordLineCall(tx, call(circle.circleId)))).rejects.toThrow();
    expect(await asService(db.service, circle.circleId, (tx) => readLineRecord(tx, circle.circleId))).toBeNull();
  });

  it("is not available to a signed-in person, who has their own operation", async () => {
    const circle = await visitorWithCircle(db);
    const code = await errorCode(
      asPerson(db.app, circle.userId, (tx) =>
        tx.execute(
          sql`select kin_private.record_office_line_call(${circle.circleId}::uuid, 'CA1', null, null, null, null, null, null, '[]'::jsonb, '{}'::text[], null, null, 'no_match'::public.claim_verdict, 'falseDemand', 'x', 'x')`,
        ),
      ),
    );
    expect(code).toBe(REFUSED.permission);
  });

  it("refuses a call that is not valid: an oversized alert, a non-positive amount, a transcript that is not a list", async () => {
    const circle = await visitorWithCircle(db);
    for (const patch of [{ spoken: "x".repeat(601) }, { claimedCents: 0 }, { claim: "" }, { callerNumber: "1".repeat(33) }] as const) {
      await expect(asService(db.service, circle.circleId, (tx) => recordLineCall(tx, call(circle.circleId, patch)))).rejects.toThrow();
    }
    expect(await asService(db.service, circle.circleId, (tx) => countIn(tx, "office_calls", circle.circleId))).toBe(0);
  });

  it("refuses a call id that is empty, too long or not letters and digits, and records nothing", async () => {
    const circle = await visitorWithCircle(db);
    for (const callSid of ["", "CA".padEnd(65, "1"), "CA 1", "CA-1", "CA1'; --"]) {
      await expect(asService(db.service, circle.circleId, (tx) => recordLineCall(tx, call(circle.circleId, { callSid })))).rejects.toMatchObject({ reason: "invalid" });
    }
    expect(await asService(db.service, circle.circleId, (tx) => countIn(tx, "office_calls", circle.circleId))).toBe(0);
  });

  const counts = (circleId: string) =>
    asService(db.service, circleId, async (tx) => {
      const rows = await tx.execute<{ calls: number; checks: number; alerts: number; audits: number }>(sql`
        select (select count(*)::int from office_calls) as calls, (select count(*)::int from claim_checks where id in (select claim_check_id from office_calls)) as checks,
               (select count(*)::int from narrations where claim_check_id in (select claim_check_id from office_calls)) as alerts,
               (select count(*)::int from audit_log where action = 'office_call.recorded') as audits`);
      return rows.rows[0];
    });

  it("records one call once: the same call id again returns the first call and creates nothing", async () => {
    const circle = await visitorWithCircle(db);
    const input = call(circle.circleId);
    const first = await asService(db.service, circle.circleId, (tx) => recordLineCall(tx, input));
    const before = await counts(circle.circleId);
    const again = await asService(db.service, circle.circleId, (tx) => recordLineCall(tx, input));
    expect(again).toEqual(first);
    expect(await counts(circle.circleId)).toEqual(before);
    expect(before).toMatchObject({ calls: 1, checks: 1, audits: 1 });
    expect(before?.alerts).toBeGreaterThan(0);
  });

  it("records one call once when two deliveries race: the second is undone whole and answers with the first", async () => {
    const circle = await visitorWithCircle(db);
    const input = call(circle.circleId);
    const [one, two] = await Promise.all([
      asService(db.service, circle.circleId, (tx) => recordLineCall(tx, input)),
      asService(db.service, circle.circleId, (tx) => recordLineCall(tx, input)),
    ]);
    expect(two).toEqual(one);
    const after = await counts(circle.circleId);
    expect(after).toMatchObject({ calls: 1, checks: 1, audits: 1 });
    // One alert per member who sees the money, from the one claim check only.
    const alerted = await asService(db.service, circle.circleId, (tx) => tx.execute<{ n: number }>(sql`select count(distinct claim_check_id)::int as n from narrations where claim_check_id in (select claim_check_id from office_calls)`));
    expect(alerted.rows[0]?.n).toBe(1);
  });

  it("records a different call id as a second call", async () => {
    const circle = await visitorWithCircle(db);
    await asService(db.service, circle.circleId, (tx) => recordLineCall(tx, call(circle.circleId)));
    await asService(db.service, circle.circleId, (tx) => recordLineCall(tx, call(circle.circleId)));
    expect(await counts(circle.circleId)).toMatchObject({ calls: 2, checks: 2, audits: 2 });
  });
});
