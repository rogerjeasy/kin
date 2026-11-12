import { randomUUID } from "node:crypto";

import { checkBillReview } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { recordBillPaidOutside, reviewBill } from "./bill-payments.ts";
import { addLetter } from "./letters.ts";
import { answerProposal } from "./operations.ts";
import { takeDemoSeat } from "./people.ts";
import { creditReceipt, decideReceipt } from "./receipts.ts";
import { auditLog, bills, executions, outbox, payees, proposals, receipts } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import type { Transaction } from "./connection.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode, REFUSED } from "./testing/sql.ts";

const db = testDatabases();
// Rose's circle's own clock, so the plan's 72 hours are counted from the moment the database counts from.
const CLOCK = new Date("2026-10-30T18:00:00Z");
const EMAIL = "billing@greenway.example";

type Persona = keyof VisitorCircle["members"];
const asPersona = <T>(circle: VisitorCircle, persona: Persona, work: (tx: Transaction) => Promise<T>) =>
  asPerson(db.app, circle.userId, async (tx) => {
    await takeDemoSeat(tx, circle.circleId, circle.members[persona]);
    return work(tx);
  });

/** Rose holds up a bill from a sender the circle has never paid, or from `payeeId`. */
async function letterBill(circle: VisitorCircle, payeeId: string | null = null, cents = 8_640): Promise<{ billId: string; payeeId: string }> {
  const recorded = await asPersona(circle, "rose", (tx) =>
    addLetter(tx, { circleId: circle.circleId, kind: "bill", payeeId, sender: "Greenway Power", amountCents: cents, dueOn: "2026-11-20", extraction: { kind: "bill" }, confidence: 0.9 }),
  );
  if (!recorded.billId || !recorded.payeeId) throw new Error("The letter made no bill");
  return { billId: recorded.billId, payeeId: recorded.payeeId };
}

const review = (circle: VisitorCircle, billId: string, persona: Persona = "elena", overrides: Record<string, unknown> = {}) =>
  asPersona(circle, persona, (tx) =>
    reviewBill(tx, { circleId: circle.circleId, billId, now: CLOCK, review: checkBillReview({ name: "Greenway Power", cents: 6_100, dueOn: "2026-11-30", receiver: EMAIL, ...overrides }) }),
  );
const paidOutside = (circle: VisitorCircle, billId: string, persona: Persona = "marcus", receiptId: string = randomUUID()) =>
  asPersona(circle, persona, (tx) => recordBillPaidOutside(tx, { circleId: circle.circleId, billId, receiptId, spentOn: "2026-10-29" }));
const service = <T>(circle: VisitorCircle, work: (tx: Transaction) => Promise<T>) => asService(db.service, circle.circleId, work);
const billRow = async (circle: VisitorCircle, billId: string) => (await service(circle, (tx) => tx.select().from(bills).where(eq(bills.id, billId))))[0];

describe("reviewing a bill read from a letter, to be paid through PayPal", () => {
  it("confirms the payee, amount and due day, and raises one bill payment the agreement plans, told to the whole circle", async () => {
    const circle = await visitorWithCircle(db);
    const { billId, payeeId } = await letterBill(circle);
    const reviewed = await review(circle, billId);
    expect(reviewed.route).toBe("paypal");

    const rows = await service(circle, async (tx) => ({
      proposal: (await tx.select().from(proposals).where(eq(proposals.id, reviewed.proposalId ?? "")))[0],
      payee: (await tx.select().from(payees).where(eq(payees.id, payeeId)))[0],
      audit: await tx.select().from(auditLog).where(and(eq(auditLog.subjectId, billId), eq(auditLog.action, "bill.reviewed"))),
    }));
    expect(rows.proposal).toMatchObject({ kind: "bill_payment", cents: 6_100, payeeId, purpose: "letter_bill", raisedBy: circle.members.elena, state: "pending_approval", billId });
    // 61.00 is above Rose's 50.00 and she decides; it is below the 500.00 second approval.
    expect(rows.proposal?.plan).toMatchObject({ outcome: "needs_approval", slots: [{ reason: "parent_decides", roles: ["parent"] }], payeeMemberId: null, announceToCircle: true });
    expect(rows.proposal?.expiresAt?.toISOString()).toBe(new Date(CLOCK.getTime() + 72 * 3_600_000).toISOString());
    expect(rows.payee).toMatchObject({ paypalReceiver: EMAIL, status: "new" });
    expect(await billRow(circle, billId)).toMatchObject({ amountCents: 6_100, dueOn: "2026-11-30", state: "proposed" });
    expect(rows.audit).toHaveLength(1);
  });

  it("returns the same proposal to a retry", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    const first = await review(circle, billId);
    expect(await review(circle, billId)).toEqual(first);
    expect(await service(circle, (tx) => tx.select().from(proposals).where(eq(proposals.billId, billId)))).toHaveLength(1);
  });

  it("queues the payout to the reviewed address in the transaction of the yes that approves it", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    const { proposalId } = await review(circle, billId);
    if (!proposalId) throw new Error("No proposal was raised");
    const outcome = await asPersona(circle, "rose", (tx) =>
      answerProposal(tx, { circleId: circle.circleId, memberId: circle.members.rose, role: "parent" }, { proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null }),
    );
    expect(outcome).toBe("approved");
    const [execution] = await service(circle, (tx) => tx.select().from(executions).where(eq(executions.proposalId, proposalId)));
    expect(execution).toMatchObject({ idempotencyKey: `kin-payout-${proposalId}`, state: "created", receiver: EMAIL, wallet: "paypal" });
    const messages = await service(circle, (tx) => tx.select({ topic: outbox.topic, payload: outbox.payload }).from(outbox).where(and(eq(outbox.circleId, circle.circleId), eq(outbox.topic, "payout.execute"))));
    expect(messages).toContainEqual({ topic: "payout.execute", payload: { executionId: execution?.id } });
  });

  it("refuses a plan that asks for fewer answers than the agreement", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    const plan = { outcome: "needs_approval", slots: [{ reason: "organizer", roles: ["organizer"] }], payeeMemberId: null, announceToCircle: true, expiresAt: new Date(CLOCK.getTime() + 72 * 3_600_000).toISOString() };
    const code = await errorCode(asPersona(circle, "elena", (tx) => tx.execute(sql`select kin_private.review_bill(${circle.circleId}::uuid, ${billId}::uuid, 'Greenway Power', 6100, '2026-11-30'::date, ${EMAIL}, ${JSON.stringify(plan)}::jsonb)`)));
    expect(code).toBe("23514");
    expect((await billRow(circle, billId))?.state).toBe("needs_review");
  });

  it("keeps an approved payee's name as the family approved it, and lets it be given a first address", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle, circle.payees.water);
    await expect(review(circle, billId, "elena", { name: "Lakeside Water Ltd" })).rejects.toMatchObject({ reason: "payee_fixed" });
    await expect(review(circle, billId, "elena", { name: "Lakeside Water" })).resolves.toMatchObject({ route: "paypal" });
  });

  it("makes an approved payee new again when it is given an address, so the family approves it and everyone is told", async () => {
    const circle = await visitorWithCircle(db);
    // Northfield Electric is approved and paid on a standing rule; it has no PayPal address.
    const { billId } = await letterBill(circle, circle.payees.electricity);
    const { proposalId } = await review(circle, billId, "elena", { name: "Northfield Electric" });
    const rows = await service(circle, async (tx) => ({
      payee: (await tx.select().from(payees).where(eq(payees.id, circle.payees.electricity)))[0],
      proposal: (await tx.select().from(proposals).where(eq(proposals.id, proposalId ?? "")))[0],
      audit: await tx.select().from(auditLog).where(and(eq(auditLog.subjectId, circle.payees.electricity), eq(auditLog.action, "payee.readdressed"))),
    }));
    expect(rows.payee).toMatchObject({ status: "new", paypalReceiver: EMAIL, autoPayRuleId: null, autoPayMinCents: null, autoPayMaxCents: null });
    expect(rows.proposal?.plan).toMatchObject({ announceToCircle: true, raiserMemberId: circle.members.elena });
    expect(rows.audit.map((row) => row.details)).toEqual([{ billId, wasApproved: true }]);
  });

  it("refuses a plan that leaves out who confirmed where the money goes, or tells nobody about a payee given an address", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle, circle.payees.water, 4_000);
    const base = { outcome: "needs_approval", slots: [{ reason: "organizer", roles: ["organizer"] }], payeeMemberId: null, expiresAt: new Date(CLOCK.getTime() + 72 * 3_600_000).toISOString() };
    for (const plan of [{ ...base, announceToCircle: true }, { ...base, announceToCircle: false, raiserMemberId: circle.members.elena }, { ...base, announceToCircle: true, raiserMemberId: circle.members.marcus }]) {
      const code = await errorCode(asPersona(circle, "elena", (tx) => tx.execute(sql`select kin_private.review_bill(${circle.circleId}::uuid, ${billId}::uuid, 'Lakeside Water', 4000, '2026-11-30'::date, ${EMAIL}, ${JSON.stringify(plan)}::jsonb)`)));
      expect(code).toBe("23514");
    }
  });

  it("never lets the reviewer's own yes complete it: another member who shares the cost must say yes too", async () => {
    const circle = await visitorWithCircle(db);
    // 40.00 is below Rose's 50.00, so only the organizer's place is asked for, and Elena, who reviewed it, is the organizer.
    const { billId } = await letterBill(circle, null, 4_000);
    const { proposalId } = await review(circle, billId, "elena", { cents: 4_000 });
    if (!proposalId) throw new Error("No proposal was raised");
    const answer = (persona: "elena" | "marcus", role: "organizer" | "contributor") =>
      asPersona(circle, persona, (tx) => answerProposal(tx, { circleId: circle.circleId, memberId: circle.members[persona], role }, { proposalId, decision: "approve", method: "app", now: CLOCK, pausedUntil: null }));
    expect(await answer("elena", "organizer")).toBe("pending");
    // Writing the state directly is refused by the database too.
    expect(await errorCode(asPersona(circle, "elena", (tx) => tx.update(proposals).set({ state: "approved" }).where(eq(proposals.id, proposalId))))).toBe("23514");
    expect(await service(circle, (tx) => tx.select().from(executions).where(eq(executions.proposalId, proposalId)))).toHaveLength(0);
    expect(await answer("marcus", "contributor")).toBe("approved");
    expect(await service(circle, (tx) => tx.select().from(executions).where(eq(executions.proposalId, proposalId)))).toHaveLength(1);
  });

  it("never points a payee with a payment under way at another address", async () => {
    const circle = await visitorWithCircle(db);
    // The stairlift's repair waits for the family's yes in Rose's circle.
    const { billId } = await letterBill(circle, circle.payees.stairlift);
    await expect(review(circle, billId, "elena", { name: "Ridgeway Stairlifts" })).rejects.toMatchObject({ reason: "payment_in_progress" });
  });

  it("lets a contributor review, and refuses the caregiver, the observer, the parent and another circle", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    for (const persona of ["daniel", "rose"] as const) {
      await expect(review(circle, billId, persona)).rejects.toMatchObject({ reason: "refused" });
    }
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    await expect(asPerson(db.app, caregiver, (tx) => reviewBill(tx, { circleId: circle.circleId, billId, now: CLOCK, review: checkBillReview({ name: "Greenway Power", cents: 6_100, dueOn: null, receiver: EMAIL }) }))).rejects.toMatchObject({ reason: "refused" });
    const other = await visitorWithCircle(db);
    await expect(asPerson(db.app, other.userId, (tx) => reviewBill(tx, { circleId: circle.circleId, billId, now: CLOCK, review: checkBillReview({ name: "Greenway Power", cents: 6_100, dueOn: null, receiver: EMAIL }) }))).rejects.toMatchObject({ reason: "refused" });
    await expect(review(circle, billId, "marcus")).resolves.toMatchObject({ route: "paypal" });
  });

  it("grants the web app no direct write to bills, payees or proposals", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    expect(await errorCode(asPersona(circle, "elena", (tx) => tx.update(bills).set({ state: "ready" }).where(eq(bills.id, billId))))).toBe(REFUSED.permission);
  });
});

describe("a bill paid outside Kin", () => {
  it("is kept to be paid outside Kin, recorded by a member as their receipt, and paid once another member's yes is credited", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    expect(await review(circle, billId, "elena", { receiver: null })).toEqual({ route: "outside", proposalId: null });
    expect(await review(circle, billId, "elena", { receiver: null })).toEqual({ route: "outside", proposalId: null });
    expect((await billRow(circle, billId))?.state).toBe("ready");
    expect(await service(circle, (tx) => tx.select().from(proposals).where(eq(proposals.billId, billId)))).toHaveLength(0);

    const receiptId = randomUUID();
    expect(await paidOutside(circle, billId, "marcus", receiptId)).toBe(receiptId);
    expect(await paidOutside(circle, billId, "marcus", receiptId)).toBe(receiptId);
    const [receipt] = await service(circle, (tx) => tx.select().from(receipts).where(eq(receipts.id, receiptId)));
    expect(receipt).toMatchObject({ memberId: circle.members.marcus, billId, cents: 6_100, category: "other", description: "Greenway Power", state: "submitted" });
    // Nobody records the same bill twice, and nobody approves their own receipt.
    await expect(paidOutside(circle, billId, "ana")).rejects.toMatchObject({ reason: "not_waiting" });
    await expect(asPersona(circle, "marcus", (tx) => decideReceipt(tx, { circleId: circle.circleId, receiptId, approve: true }))).rejects.toMatchObject({ reason: "refused" });

    await asPersona(circle, "elena", (tx) => decideReceipt(tx, { circleId: circle.circleId, receiptId, approve: true }));
    expect((await billRow(circle, billId))?.state).toBe("ready");
    expect(await service(circle, (tx) => creditReceipt(tx, circle.circleId, receiptId, CLOCK))).toBe("credited");
    expect((await billRow(circle, billId))?.state).toBe("paid");
  });

  it("can be recorded again after another member declines the receipt", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    await review(circle, billId, "elena", { receiver: null });
    const receiptId = await paidOutside(circle, billId, "marcus");
    await asPersona(circle, "elena", (tx) => decideReceipt(tx, { circleId: circle.circleId, receiptId, approve: false }));
    await expect(paidOutside(circle, billId, "ana")).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is refused before review, and for the caregiver, the observer, the parent and another circle", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    await expect(paidOutside(circle, billId)).rejects.toMatchObject({ reason: "not_waiting" });
    await review(circle, billId, "elena", { receiver: null });
    for (const persona of ["daniel", "rose"] as const) {
      await expect(paidOutside(circle, billId, persona)).rejects.toMatchObject({ reason: "refused" });
    }
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    await expect(asPerson(db.app, caregiver, (tx) => recordBillPaidOutside(tx, { circleId: circle.circleId, billId, receiptId: randomUUID(), spentOn: "2026-10-29" }))).rejects.toMatchObject({ reason: "refused" });
    const other = await visitorWithCircle(db);
    await expect(asPerson(db.app, other.userId, (tx) => recordBillPaidOutside(tx, { circleId: circle.circleId, billId, receiptId: randomUUID(), spentOn: "2026-10-29" }))).rejects.toMatchObject({ reason: "refused" });
  });

  it("can still be sent through PayPal once the payee has an address, until a member records paying it", async () => {
    const circle = await visitorWithCircle(db);
    const { billId } = await letterBill(circle);
    await review(circle, billId, "elena", { receiver: null });
    await expect(review(circle, billId)).resolves.toMatchObject({ route: "paypal" });
    expect((await billRow(circle, billId))?.state).toBe("proposed");
  });
});
