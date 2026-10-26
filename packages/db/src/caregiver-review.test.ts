import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { configureCaregiver, setCaregiverReceiver, submitCaregiverBill } from "./caregiver-billing.ts";
import { declineCaregiverBill, sendCaregiverBill } from "./caregiver-review.ts";
import { answerProposal, type Seat } from "./operations.ts";
import { createCircle, membershipsOf, takeDemoSeat } from "./people.ts";
import { readCircle } from "./read-circle.ts";
import { approvals, auditLog, bills, circles, members, payees, proposals } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { seatPerson, signedIn, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode, REFUSED } from "./testing/sql.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const visits = (days: readonly string[]) => ({ version: 1, currency: "USD", rateCentsPerHour: 2200, visits: days.map((date) => ({ date, minutes: 240 })) });
const THREE_DAYS = ["2026-10-20", "2026-10-21", "2026-10-22"];
// Six four-hour days at 22.00 is 528.00, above the 500.00 second-approval threshold.
const SIX_DAYS = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"];

type Family = VisitorCircle & { readonly caregiver: string };

async function familyWithBill(days: readonly string[] = THREE_DAYS): Promise<Family & { readonly billId: string }> {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  await asPerson(db.app, circle.userId, (tx) =>
    configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 2200 }),
  );
  const billId = await asPerson(db.app, caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: visits(days), submissionKey: randomUUID() }));
  return { ...circle, caregiver, billId };
}

const send = (circle: Family, billId: string, userId = circle.userId) =>
  asPerson(db.app, userId, (tx) => sendCaregiverBill(tx, { circleId: circle.circleId, billId, now: CLOCK }));
const decline = (circle: Family, billId: string, userId = circle.userId) =>
  asPerson(db.app, userId, (tx) => declineCaregiverBill(tx, { circleId: circle.circleId, billId }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) =>
  asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
const billState = async (circle: VisitorCircle, billId: string) => {
  const [row] = await asService(db.service, circle.circleId, (tx) => tx.select({ state: bills.state }).from(bills).where(eq(bills.id, billId)));
  return row?.state;
};
const seatOf = async (circle: VisitorCircle): Promise<Seat> => {
  const snapshot = await asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
  return { circleId: circle.circleId, memberId: snapshot.viewer.memberId, role: snapshot.viewer.role };
};
const answer = async (circle: VisitorCircle, proposalId: string, decision: "approve" | "reject") =>
  asPerson(db.app, circle.userId, async (tx) => answerProposal(tx, await seatOf(circle), { proposalId, decision, method: "app", now: CLOCK, pausedUntil: null }));

describe("the family's review of a caregiver's bill", () => {
  it("raises one caregiver payout for the bill's own amount, planned by the agreement, that the caregiver can follow", async () => {
    const circle = await familyWithBill();
    const proposalId = await send(circle, circle.billId);

    const [proposal] = await asService(db.service, circle.circleId, (tx) => tx.select().from(proposals).where(eq(proposals.id, proposalId)));
    expect(proposal).toMatchObject({
      kind: "caregiver_payout",
      cents: 26_400,
      payeeId: circle.payees.amara,
      purpose: "caregiver_bill",
      raisedBy: circle.members.elena,
      state: "pending_approval",
      billId: circle.billId,
    });
    // 264.00 is above Rose's 50.00, and Rose decides; it is below the 500.00 second approval.
    expect(proposal?.plan).toMatchObject({ outcome: "needs_approval", slots: [{ reason: "parent_decides", roles: ["parent"] }], payeeMemberId: circle.members.amara });
    expect(proposal?.expiresAt?.toISOString()).toBe(new Date(CLOCK.getTime() + 72 * 3_600_000).toISOString());
    expect(await billState(circle, circle.billId)).toBe("proposed");

    const audit = await asService(db.service, circle.circleId, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.subjectId, circle.billId), eq(auditLog.action, "caregiver_bill.sent"))));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toEqual({ proposalId });

    const seen = await asPerson(db.app, circle.caregiver, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.caregiver, now: CLOCK }));
    expect(seen.proposals.map((each) => each.id)).toContain(proposalId);
  });

  it("asks for a second approval above the agreement's threshold", async () => {
    const circle = await familyWithBill(SIX_DAYS);
    const proposalId = await send(circle, circle.billId);
    const [proposal] = await asService(db.service, circle.circleId, (tx) => tx.select().from(proposals).where(eq(proposals.id, proposalId)));
    expect(proposal?.cents).toBe(52_800);
    expect(proposal?.plan).toMatchObject({ slots: [{ reason: "parent_decides" }, { reason: "second_approval", roles: ["organizer", "contributor"] }] });
  });

  it("returns the same proposal to a retry, even when two arrive at once", async () => {
    const circle = await familyWithBill();
    const ids = await Promise.all([send(circle, circle.billId), send(circle, circle.billId)]);
    expect(ids[0]).toBe(ids[1]);
    expect(await send(circle, circle.billId)).toBe(ids[0]);
    const raised = await asService(db.service, circle.circleId, (tx) => tx.select().from(proposals).where(eq(proposals.billId, circle.billId)));
    expect(raised).toHaveLength(1);
  });

  it("lets a contributor review, and refuses the caregiver, the observer and the parent", async () => {
    const circle = await familyWithBill();
    for (const persona of ["daniel", "rose"] as const) {
      await as(circle, persona);
      await expect(send(circle, circle.billId)).rejects.toMatchObject({ reason: "refused" });
      await expect(decline(circle, circle.billId)).rejects.toMatchObject({ reason: "refused" });
    }
    await expect(send(circle, circle.billId, circle.caregiver)).rejects.toMatchObject({ reason: "refused" });
    await as(circle, "marcus");
    await expect(send(circle, circle.billId)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("declines a bill once, frees its days for a corrected bill, and cannot decline what was sent", async () => {
    const circle = await familyWithBill();
    await decline(circle, circle.billId);
    await decline(circle, circle.billId);
    expect(await billState(circle, circle.billId)).toBe("rejected");
    await expect(send(circle, circle.billId)).rejects.toMatchObject({ reason: "not_waiting" });

    const corrected = await asPerson(db.app, circle.caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: visits(THREE_DAYS), submissionKey: randomUUID() }));
    await send(circle, corrected);
    await expect(decline(circle, corrected)).rejects.toMatchObject({ reason: "not_waiting" });
  });

  it("refuses to raise a proposal while the circle is paused", async () => {
    const circle = await familyWithBill();
    await asService(db.service, circle.circleId, (tx) => tx.update(circles).set({ pausedUntil: new Date(CLOCK.getTime() + 3_600_000), pausedBy: circle.members.marcus }).where(eq(circles.id, circle.circleId)));
    await expect(send(circle, circle.billId)).rejects.toMatchObject({ reason: "paused" });
    expect(await billState(circle, circle.billId)).toBe("received");
  });

  it("refuses a plan, passed straight to the operation, that asks for fewer or other answers than the agreement", async () => {
    const circle = await familyWithBill(SIX_DAYS);
    const expiresAt = new Date(CLOCK.getTime() + 72 * 3_600_000).toISOString();
    const honest = {
      outcome: "needs_approval",
      slots: [{ reason: "parent_decides", roles: ["parent"] }, { reason: "second_approval", roles: ["organizer", "contributor"] }],
      payeeMemberId: circle.members.amara,
      announceToCircle: false,
      expiresAt,
    };
    const forged = [
      { ...honest, slots: honest.slots.slice(0, 1) },
      { ...honest, slots: [{ reason: "organizer", roles: ["organizer"] }, honest.slots[1]] },
      { ...honest, payeeMemberId: circle.members.marcus },
      { ...honest, expiresAt: new Date(CLOCK.getTime() + 720 * 3_600_000).toISOString() },
      { outcome: "standing_rule", ruleId: "x", agreementVersion: 1 },
      { ...honest, extra: true },
    ];
    for (const plan of forged) {
      const attempt = asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select kin_private.send_caregiver_bill(${circle.circleId}::uuid, ${circle.billId}::uuid, ${JSON.stringify(plan)}::jsonb)`));
      expect(await errorCode(attempt)).toBe(REFUSED.check);
    }
    expect(await billState(circle, circle.billId)).toBe("received");
    // The honest plan is accepted, so the refusals above are about the plan alone.
    await asPerson(db.app, circle.userId, (tx) => tx.execute(sql`select kin_private.send_caregiver_bill(${circle.circleId}::uuid, ${circle.billId}::uuid, ${JSON.stringify(honest)}::jsonb)`));
  });

  it("is approved by Rose's yes in the demo, and the caregiver can never answer", async () => {
    const circle = await familyWithBill();
    const proposalId = await send(circle, circle.billId);
    const attempt = asPerson(db.app, circle.caregiver, (tx) =>
      tx.insert(approvals).values({ id: randomUUID(), circleId: circle.circleId, proposalId, memberId: circle.members.amara, role: "caregiver", decision: "approve", method: "app", decidedAt: CLOCK }),
    );
    expect(await errorCode(attempt)).toBe(REFUSED.permission);
    await as(circle, "rose");
    expect(await answer(circle, proposalId, "approve")).toBe("approved");
  });

  it("never lets the web identity write a bill's state or a proposal directly", async () => {
    const circle = await familyWithBill();
    const moveBill = () => asPerson(db.app, circle.userId, (tx) => tx.update(bills).set({ state: "rejected" }).where(eq(bills.id, circle.billId)));
    const raise = () =>
      asPerson(db.app, circle.userId, (tx) =>
        tx.insert(proposals).values({ id: randomUUID(), circleId: circle.circleId, kind: "caregiver_payout", cents: 1, payeeId: circle.payees.amara, purpose: "caregiver_bill", raisedAt: CLOCK, state: "pending_approval", agreementVersion: 1, plan: {} }),
      );
    expect(await errorCode(moveBill())).toBe(REFUSED.permission);
    expect(await errorCode(raise())).toBe(REFUSED.permission);
  });
});

describe("answers to real money", () => {
  async function realProposal() {
    const organizer = await signedIn(db.app, "Priya Shah");
    const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "informed", relationship: null }));
    const [seat] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
    if (!seat) throw new Error("The organizer has no seat");
    const payeeId = randomUUID();
    const proposalId = randomUUID();
    await asService(db.service, circleId, async (tx) => {
      await tx.insert(payees).values({ id: payeeId, circleId, name: "Gas", category: "utilities", status: "approved" });
      await tx.insert(proposals).values({
        id: proposalId, circleId, kind: "bill_payment", cents: 4_000, payeeId, purpose: "utility_bill", raisedAt: new Date(), state: "pending_approval",
        expiresAt: new Date(Date.now() + 72 * 3_600_000), agreementVersion: 1,
        plan: { outcome: "needs_approval", slots: [{ reason: "organizer", roles: ["organizer"] }], payeeMemberId: null, announceToCircle: false, expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString() },
      });
    });
    const real: Seat = { circleId, memberId: seat.memberId, role: "organizer" };
    return { organizer, real, proposalId };
  }
  const answerReal = (userId: string, seat: Seat, proposalId: string, decision: "approve" | "reject", evidenceRef: string | null) =>
    asPerson(db.app, userId, (tx) => answerProposal(tx, seat, { proposalId, decision, method: "app", evidenceRef, now: new Date(), pausedUntil: null }));

  it("refuses a yes without the fresh multi-factor check's evidence", async () => {
    const { organizer, real, proposalId } = await realProposal();
    expect(await errorCode(answerReal(organizer, real, proposalId, "approve", null))).toBe(REFUSED.permission);
    expect(await errorCode(answerReal(organizer, real, proposalId, "approve", "trust me"))).toBe(REFUSED.permission);
  });

  it("accepts a yes that carries the evidence, and approves the proposal", async () => {
    const { organizer, real, proposalId } = await realProposal();
    expect(await answerReal(organizer, real, proposalId, "approve", "cognito:jti-1:1793000000:pwd+otp+mfa")).toBe("approved");
    const [row] = await asService(db.service, real.circleId, (tx) => tx.select().from(approvals).where(eq(approvals.proposalId, proposalId)));
    expect(row?.evidenceRef).toBe("cognito:jti-1:1793000000:pwd+otp+mfa");
  });

  it("accepts a no without a fresh check, because a no stops money", async () => {
    const { organizer, real, proposalId } = await realProposal();
    expect(await answerReal(organizer, real, proposalId, "reject", null)).toBe("rejected");
  });

  it("refuses to approve a real proposal whose yes lacks evidence, even written straight to the table", async () => {
    const { organizer, real, proposalId } = await realProposal();
    // The service can write what a person cannot; a person's decision then still needs the evidence.
    await asService(db.service, real.circleId, (tx) => tx.insert(approvals).values({ id: randomUUID(), circleId: real.circleId, proposalId, memberId: real.memberId, role: "organizer", decision: "approve", method: "app", decidedAt: new Date() }));
    const decide = asPerson(db.app, organizer, (tx) => tx.update(proposals).set({ state: "approved" }).where(eq(proposals.id, proposalId)));
    expect(await errorCode(decide)).toBe(REFUSED.permission);
    const [member] = await asService(db.service, real.circleId, (tx) => tx.select({ role: members.role }).from(members).where(eq(members.id, real.memberId)));
    expect(member?.role).toBe("organizer");
  });
});

describe("where a caregiver's pay goes", () => {
  const setReceiver = (circle: Family, email: string, userId = circle.userId) =>
    asPerson(db.app, userId, (tx) => setCaregiverReceiver(tx, { circleId: circle.circleId, payeeId: circle.payees.amara, email }));
  const stored = async (circle: Family) => {
    const [row] = await asService(db.service, circle.circleId, (tx) => tx.select({ receiver: payees.paypalReceiver }).from(payees).where(eq(payees.id, circle.payees.amara)));
    return row?.receiver;
  };

  it("is recorded by the organizer, normalized, audited without the address, and read back masked", async () => {
    const circle = await familyWithBill();
    await setReceiver(circle, "  Amara.Doe@Personal.Example.com ");
    expect(await stored(circle)).toBe("amara.doe@personal.example.com");
    const audit = await asService(db.service, circle.circleId, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.subjectId, circle.payees.amara), eq(auditLog.action, "caregiver_receiver.set"))));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.details)).not.toContain("amara.doe");
    const seen = await asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
    expect(seen.payees.find((payee) => payee.id === circle.payees.amara)?.receiver).toBe("a••••@personal.example.com");
  });

  it("refuses everyone but the organizer, and an address that is not one", async () => {
    const circle = await familyWithBill();
    await expect(setReceiver(circle, "amara@example.com", circle.caregiver)).rejects.toMatchObject({ reason: "refused" });
    await as(circle, "marcus");
    await expect(setReceiver(circle, "amara@example.com")).rejects.toMatchObject({ reason: "refused" });
    await as(circle, "elena");
    for (const email of ["amara", "amara@", "a b@example.com", `${"a".repeat(130)}@example.com`]) {
      await expect(setReceiver(circle, email)).rejects.toMatchObject({ reason: "receiver" });
    }
    expect(await stored(circle)).toBeNull();
  });

  it("cannot change while a payment to the caregiver is approved and not yet paid", async () => {
    const circle = await familyWithBill();
    await setReceiver(circle, "amara@example.com");
    const proposalId = await send(circle, circle.billId);
    await as(circle, "rose");
    expect(await answer(circle, proposalId, "approve")).toBe("approved");
    await as(circle, "elena");
    await expect(setReceiver(circle, "someone.else@example.com")).rejects.toMatchObject({ reason: "payment_in_progress" });
    expect(await stored(circle)).toBe("amara@example.com");
  });
});
