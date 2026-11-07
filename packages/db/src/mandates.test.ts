import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { asPerson, asService } from "./scope.ts";
import { MandateError, grantMandate, mandateDigest, newMandateId, readMandateRecords, setMandateStatus } from "./mandates.ts";
import { personQuery, seatPerson, serviceRows, snapshotFor, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";
import { testDatabases } from "./testing/databases.ts";
import { REFUSED, errorCode } from "./testing/sql.ts";

const db = testDatabases();
const NOW = new Date("2026-10-30T18:00:00Z");

async function terms(circle: VisitorCircle, change: Partial<Parameters<typeof grantMandate>[1]> = {}) {
  const [rule] = (await snapshotFor(db, circle.userId, circle.circleId)).purchaseRules;
  if (!rule) throw new Error("The demo circle has no refill rule");
  return { circleId: circle.circleId, id: newMandateId(), ruleId: rule.id, perPurchaseCents: 5_000, perPeriodCents: 10_000, cadence: "as_needed" as const, validFrom: "2026-10-30", expiresOn: "2027-03-31", spokenText: "Order it every month, up to fifty dollars.", now: NOW, ...change };
}
const grant = (circle: VisitorCircle, userId: string, input: Awaited<ReturnType<typeof terms>>) => asPerson(db.app, userId, (tx) => grantMandate(tx, input));

describe("granting a mandate", () => {
  it("lets the organizer play Rose's spoken yes in a demo circle, labelled simulated and sealed by a digest the code can check", async () => {
    const circle = await visitorWithCircle(db);
    const input = await terms(circle);
    await grant(circle, circle.userId, input);
    const [mandate] = (await asPerson(db.app, circle.userId, (tx) => readMandateRecords(tx, circle.circleId, NOW, "America/New_York"))).filter((each) => each.id === input.id);
    expect(mandate).toMatchObject({ grantedBy: circle.members.rose, recordedBy: circle.members.elena, simulated: true, status: "active", usedCents: 0 });
    expect(mandate?.digest).toBe(mandateDigest(input));
    // The same request again grants it once; the same key for other terms is refused.
    await grant(circle, circle.userId, input);
    await expect(grant(circle, circle.userId, { ...input, perPurchaseCents: 4_000 })).rejects.toMatchObject({ reason: "key_reused" });
  });

  it("is refused to a contributor, in a real circle to the organizer, and above the agreement's ceiling", async () => {
    const circle = await visitorWithCircle(db);
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const input = await terms(circle);
    await expect(grant(circle, marcus, input)).rejects.toBeInstanceOf(MandateError);
    await expect(grant(circle, circle.userId, { ...input, id: newMandateId(), perPurchaseCents: 400_000, perPeriodCents: 400_000 })).rejects.toMatchObject({ reason: "above_ceiling" });
    await expect(grant(circle, circle.userId, { ...input, id: newMandateId(), expiresOn: "2028-12-31" })).rejects.toMatchObject({ reason: "too_long" });
    await serviceRows(db, circle.circleId, "update circles set demo = false, clock_at = null where id = $1", [circle.circleId]);
    await expect(grant(circle, circle.userId, { ...input, id: newMandateId() })).rejects.toMatchObject({ reason: "parent_only" });
  });
});

describe("pausing and ending a mandate", () => {
  it("lets any member who answers pause it, only the parent's seat end it, and never lets an ended one return", async () => {
    const circle = await visitorWithCircle(db);
    const input = await terms(circle);
    await grant(circle, circle.userId, input);
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const set = (userId: string, status: "paused" | "active" | "revoked") => asPerson(db.app, userId, (tx) => setMandateStatus(tx, { circleId: circle.circleId, mandateId: input.id, status }));

    await set(marcus, "paused");
    await expect(set(marcus, "active")).rejects.toMatchObject({ reason: "refused" });
    await expect(set(marcus, "revoked")).rejects.toMatchObject({ reason: "refused" });
    await set(circle.userId, "active");
    await set(circle.userId, "revoked");
    await expect(set(circle.userId, "active")).rejects.toMatchObject({ reason: "invalid" });
    expect(await serviceRows(db, circle.circleId, "select status, ended_at is not null as ended from mandates where id = $1", [input.id])).toEqual([{ status: "revoked", ended: true }]);
  });
});

describe("who can see or write mandates", () => {
  it("hides them from a caregiver and another circle, and lets no one write a row or label an answer as a mandate's", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const own = async (userId: string) => (await snapshotFor(db, userId, circle.circleId)).mandates.length;
    expect(await own(circle.userId)).toBe(1);

    await expect(snapshotFor(db, amara, circle.circleId).then((snapshot) => snapshot.mandates)).resolves.toEqual([]);
    expect(await errorCode(snapshotFor(db, other.userId, circle.circleId))).not.toBe("no error");

    const mandate = (await snapshotFor(db, circle.userId, circle.circleId)).mandates[0];
    expect(await errorCode(personQuery(db, circle.userId, "update mandates set per_purchase_cents = 1 where id = '" + String(mandate?.id) + "'"))).toBe(REFUSED.permission);
    expect(await errorCode(personQuery(db, circle.userId, "delete from mandate_uses"))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, other.circleId, (tx) => tx.execute(personRow(circle.circleId))))).not.toBe("no error");
  });
});

function personRow(circleId: string) {
  return sql`insert into mandate_uses (id, circle_id, mandate_id, proposal_id, cents, period) values (gen_random_uuid(), ${circleId}::uuid, gen_random_uuid(), gen_random_uuid(), 1, '2026-10')`;
}
