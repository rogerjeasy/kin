import { calculateCaregiverBill } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { configureCaregiver, submitCaregiverBill } from "./caregiver-billing.ts";
import { readCircle } from "./read-circle.ts";
import { auditLog, bills, circles, payees } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { addMember, seatPerson, visitorWithCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode, REFUSED } from "./testing/sql.ts";

const db = testDatabases();
const details = { version: 1, currency: "USD", rateCentsPerHour: 2200, visits: [{ date: "2026-10-20", minutes: 240 }, { date: "2026-10-21", minutes: 240 }, { date: "2026-10-22", minutes: 240 }] };

async function family() {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  return { ...circle, caregiver };
}
async function configured() {
  const circle = await family();
  await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 2200 }));
  return circle;
}

describe("caregiver billing with the app's own database identity", () => {
  it("refuses a caregiver or observer trying to set the rate", async () => {
    const circle = await family();
    const observer = await seatPerson(db, circle.circleId, circle.members.daniel);
    for (const userId of [circle.caregiver, observer]) {
      await expect(asPerson(db.app, userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 1 }))).rejects.toMatchObject({ reason: "refused" });
    }
  });

  it("records the organizer's rate without changing the payee's status or recipient", async () => {
    const circle = await configured();
    const [payee] = await asPerson(db.app, circle.userId, (tx) => tx.select().from(payees).where(eq(payees.id, circle.payees.amara)));
    expect(payee).toMatchObject({ caregiverRateCentsPerHour: 2200, status: "approved", paypalReceiver: null });
  });

  it("sets up one new payee for an active caregiver without approving it for payment", async () => {
    const circle = await family();
    const member = await addMember(db, circle.circleId, "caregiver");
    const configure = () => asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: member.memberId, name: "New caregiver", rateCentsPerHour: 2300 }));
    const ids = await Promise.all([configure(), configure()]);
    expect(ids[0]).toBe(ids[1]);
    const rows = await asPerson(db.app, circle.userId, (tx) => tx.select().from(payees).where(eq(payees.memberId, member.memberId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "new", caregiverRateCentsPerHour: 2300, paypalReceiver: null, autoPayRuleId: null });
  });

  it("serializes a rate change against submission of an older review", async () => {
    const circle = await configured();
    let release = () => {};
    let locked = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const changed = new Promise<void>((resolve) => { locked = resolve; });
    const update = asPerson(db.app, circle.userId, async (tx) => {
      await configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, name: "Amara", rateCentsPerHour: 2400 });
      locked();
      await hold;
    });
    await changed;
    const submitting = asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: randomUUID() }));
    release();
    await update;
    await expect(submitting).rejects.toMatchObject({ reason: "rate_changed" });
  });

  it("submits an immutable bill and exposes the same original evidence to the caregiver and family", async () => {
    const circle = await configured();
    const key = randomUUID();
    const id = await asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: key }));
    await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, name: "Amara", rateCentsPerHour: 2500 }));
    for (const userId of [circle.caregiver, circle.userId]) {
      const snapshot = await asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date("2026-10-30T18:00:00Z") }));
      expect(snapshot.bills.find((bill) => bill.id === id)).toMatchObject({ amountCents: 26400, state: "received", caregiverDetails: details });
      expect(snapshot.proposals.some((proposal) => proposal.billId === id)).toBe(false);
    }
    const rows = await asPerson(db.app, circle.userId, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.subjectId, id), eq(auditLog.action, "caregiver_bill.submitted"))));
    expect(rows).toHaveLength(1);
  });

  it("returns the same bill for concurrent retries, even after the rate has changed", async () => {
    const circle = await configured();
    const submissionKey = randomUUID();
    const submit = () => asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey }));
    const ids = await Promise.all([submit(), submit()]);
    expect(new Set(ids).size).toBe(1);
    await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, rateCentsPerHour: 2300, name: "Amara" }));
    expect(await submit()).toBe(ids[0]);
  });

  it("refuses a submission key reused for different visits", async () => {
    const circle = await configured();
    const submissionKey = randomUUID();
    await asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey }));
    await expect(asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { ...details, visits: [{ date: "2026-10-23", minutes: 60 }] }, submissionKey }))).rejects.toMatchObject({ reason: "key_reused" });
  });

  it("refuses overlapping dates even when two submissions race", async () => {
    const circle = await configured();
    const outcomes = await Promise.allSettled([0, 1].map(() => asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: randomUUID() }))));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refusal = outcomes.find((outcome) => outcome.status === "rejected");
    const original = outcomes.find((outcome) => outcome.status === "fulfilled");
    expect(refusal?.status === "rejected" ? refusal.reason : null).toMatchObject({ reason: "duplicate", billId: original?.status === "fulfilled" ? original.value : "missing" });
  });

  it("requires a fresh review when the current rate differs", async () => {
    const circle = await configured();
    await expect(asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { ...details, rateCentsPerHour: 2100 }, submissionKey: randomUUID() }))).rejects.toMatchObject({ reason: "rate_changed" });
  });

  it("cannot submit before a rate is configured", async () => {
    const circle = await family();
    await expect(asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: randomUUID() }))).rejects.toMatchObject({ reason: "missing_rate" });
  });

  it("refuses another circle, another member and another payee at the database boundary", async () => {
    const [circle, other] = await Promise.all([configured(), configured()]);
    await expect(asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: other.circleId, memberId: other.members.amara, name: "Intruder", rateCentsPerHour: 1 }))).rejects.toMatchObject({ reason: "refused" });
    await expect(asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: other.payees.amara, name: "Intruder", rateCentsPerHour: 1 }))).rejects.toMatchObject({ reason: "refused" });
    await expect(asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: other.circleId, details, submissionKey: randomUUID() }))).rejects.toMatchObject({ reason: "refused" });
    const foreign = await asPerson(db.app, circle.caregiver, (tx) => tx.select().from(bills).where(eq(bills.circleId, other.circleId)));
    expect(foreign).toEqual([]);
  });

  it("refuses organizer submission, archived circles, and future service dates", async () => {
    const circle = await configured();
    await expect(asPerson(db.app, circle.userId, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: randomUUID() }))).rejects.toMatchObject({ reason: "refused" });
    await expect(asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { ...details, visits: [{ date: "2026-11-01", minutes: 60 }] }, submissionKey: randomUUID() }))).rejects.toThrow();
    await asService(db.service, circle.circleId, (tx) => tx.update(circles).set({ status: "archived" }).where(eq(circles.id, circle.circleId)));
    await expect(asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: randomUUID() }))).rejects.toMatchObject({ reason: "refused" });
  });

  it("rolls back the bill and audit together when the surrounding transaction fails", async () => {
    const circle = await configured();
    const submissionKey = randomUUID();
    await expect(asPerson(db.app, circle.caregiver, async (tx) => {
      await submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey });
      throw new Error("abort");
    })).rejects.toThrow("abort");
    const rows = await asService(db.service, circle.circleId, (tx) => tx.select().from(bills).where(eq(bills.submissionKey, submissionKey)));
    expect(rows).toEqual([]);
  });

  it("refuses edits to submitted evidence even from the service, and keeps direct app writes denied", async () => {
    const circle = await configured();
    const id = await asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details, submissionKey: randomUUID() }));
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.update(bills).set({ amountCents: 1 }).where(eq(bills.id, id))))).toBe(REFUSED.restrict);
    expect(await errorCode(asPerson(db.app, circle.caregiver, (tx) => tx.insert(bills).values({ id: randomUUID(), circleId: circle.circleId, payeeId: circle.payees.amara, amountCents: 1, receivedOn: "2026-10-30" })))).toBe(REFUSED.permission);
  });

  it("refuses forged identities passed straight to the privileged operation", async () => {
    const circle = await configured();
    const bill = calculateCaregiverBill(details);
    expect(await errorCode(asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select kin_private.submit_caregiver_bill(${circle.circleId}, ${randomUUID()}::uuid, ${JSON.stringify(bill.details)}::jsonb, ${bill.cents}::bigint)`)))).toBe(REFUSED.permission);
  });

  it("refuses a direct operation whose amount disagrees with the visit evidence", async () => {
    const circle = await configured();
    const bill = calculateCaregiverBill(details);
    const code = await errorCode(asPerson(db.app, circle.caregiver, (tx) => tx.execute(sql`select kin_private.submit_caregiver_bill(${circle.circleId}, ${randomUUID()}::uuid, ${JSON.stringify(bill.details)}::jsonb, 1::bigint)`)));
    expect(code).toBe(REFUSED.check);
    const snapshot = await asPerson(db.app, circle.caregiver, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.caregiver, now: new Date("2026-10-30T18:00:00Z") }));
    expect(snapshot.bills.some((row) => row.caregiverDetails !== null)).toBe(false);
  });

  it("accepts the domain's per-day fractional-hour rounding at the database boundary", async () => {
    const circle = await configured();
    await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, name: "Amara", rateCentsPerHour: 90 }));
    const id = await asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { ...details, rateCentsPerHour: 90, visits: [{ date: "2026-10-20", minutes: 1 }, { date: "2026-10-21", minutes: 1 }] }, submissionKey: randomUUID() }));
    const [bill] = await asPerson(db.app, circle.caregiver, (tx) => tx.select().from(bills).where(eq(bills.id, id)));
    expect(bill?.amountCents).toBe(4);
  });
});
