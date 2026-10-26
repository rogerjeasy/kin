import { asPerson, configureCaregiver, readCircle, type CircleSnapshot } from "@kin/db";
import { seatPerson, visitorWithCircle } from "@kin/db/testing";
import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { describe, expect, it } from "vitest";

import { fakeModel, visitsReply } from "@kin/agent/testing";

import { runCaregiverBilling } from "./caregiver-billing";
import { createRateLimiter } from "./model";

const db = testDatabases();
async function setup() {
  const circle = await visitorWithCircle(db);
  const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
  await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, name: "Amara", rateCentsPerHour: 2200 }));
  const snapshot = (userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date("2026-10-30T18:00:00Z") }));
  return { circle, caregiver, snapshot };
}
const visits = [{ date: "2026-10-22", minutes: 240 }];

describe("caregiver billing at the untrusted request boundary", () => {
  it("reviews from the recorded rate and submits the reviewed details", async () => {
    const { caregiver, snapshot } = await setup();
    const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const };
    const review = await runCaregiverBilling(context, { operation: "review", visits });
    expect(review).toMatchObject({ ok: true, bill: { cents: 8800 } });
    if (!review.ok || !("bill" in review)) throw new Error("Expected a reviewed bill");
    const submitted = await runCaregiverBilling(context, { operation: "submit", details: review.bill.details, submissionKey: review.submissionKey });
    expect(submitted).toMatchObject({ ok: true });
    expect((await snapshot(caregiver)).bills.some((bill) => bill.amountCents === 8800 && bill.state === "received")).toBe(true);
  });

  it("refuses forged rates, totals and recipient selectors on review", async () => {
    const { caregiver, snapshot } = await setup();
    const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const };
    for (const extra of [{ rateCentsPerHour: 1 }, { cents: 1 }, { payeeId: "someone-else" }]) {
      expect(await runCaregiverBilling(context, { operation: "review", visits, ...extra })).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("checks the account type separately from the circle's caregiver role", async () => {
    const { caregiver, snapshot } = await setup();
    const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: [] };
    expect(await runCaregiverBilling(context, { operation: "review", visits })).toEqual({ ok: false, reason: "refused" });
    expect(await runCaregiverBilling({ ...context, accountTypes: ["family_member"] }, { operation: "review", visits })).toEqual({ ok: false, reason: "refused" });
    expect(await runCaregiverBilling({ ...context, accountTypes: ["caregiver"] }, { operation: "review", visits })).toMatchObject({ ok: true });
  });

  it("refuses a stale rate, another currency and client-computed amounts on submission", async () => {
    const { caregiver, snapshot } = await setup();
    const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const };
    const review = await runCaregiverBilling(context, { operation: "review", visits });
    if (!review.ok || !("bill" in review)) throw new Error("Expected a reviewed bill");
    for (const extra of [{ rateCentsPerHour: 1 }, { currency: "EUR" }, { cents: 1 }]) {
      expect(await runCaregiverBilling(context, { operation: "submit", details: { ...review.bill.details, ...extra }, submissionKey: review.submissionKey })).toMatchObject({ ok: false });
    }
  });

  it("refuses a caregiver changing rates, and family members submitting caregiver bills", async () => {
    const { circle, caregiver, snapshot } = await setup();
    expect(await runCaregiverBilling({ db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" }, { operation: "configure", memberId: circle.members.amara, name: "Amara", rate: "0.01", payeeId: null })).toEqual({ ok: false, reason: "refused" });
    expect(await runCaregiverBilling({ db: db.app, userId: circle.userId, circle: await snapshot(circle.userId), accountTypes: "demo" }, { operation: "review", visits })).toEqual({ ok: false, reason: "refused" });
  });

  it("lets only the caregiver record where their own pay goes, and refuses an address that is not one", async () => {
    const { circle, caregiver, snapshot } = await setup();
    const asCaregiver = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: ["caregiver" as const] };
    expect(await runCaregiverBilling(asCaregiver, { operation: "receiver", email: "amara@example.com" })).toMatchObject({ ok: true });
    expect((await snapshot(circle.userId)).payees.find((payee) => payee.id === circle.payees.amara)?.receiver).toBe("a••••@example.com");
    expect(await runCaregiverBilling(asCaregiver, { operation: "receiver", email: "not an address" })).toEqual({ ok: false, reason: "receiver" });
    for (const input of [{ operation: "receiver", email: 42 }, { operation: "receiver", email: "a@example.com", payeeId: circle.payees.amara }]) {
      expect(await runCaregiverBilling(asCaregiver, input)).toEqual({ ok: false, reason: "invalid" });
    }
    // The organizer may not, through the request boundary or by naming the old field.
    const organizer = { db: db.app, userId: circle.userId, circle: await snapshot(circle.userId), accountTypes: ["family_member" as const] };
    expect(await runCaregiverBilling(organizer, { operation: "receiver", email: "elena@example.com" })).toEqual({ ok: false, reason: "refused" });
    expect(await runCaregiverBilling(organizer, { operation: "configure", memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rate: "22.00", receiver: "elena@example.com" })).toEqual({ ok: false, reason: "invalid" });
    // A caregiver's account type is needed as well as the caregiver seat.
    expect(await runCaregiverBilling({ ...asCaregiver, accountTypes: ["family_member"] }, { operation: "receiver", email: "a@example.com" })).toEqual({ ok: false, reason: "refused" });
  });

  describe("the family's review", () => {
    async function submitted() {
      const setupResult = await setup();
      const { caregiver, snapshot } = setupResult;
      const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const };
      const review = await runCaregiverBilling(context, { operation: "review", visits });
      if (!review.ok || !("bill" in review)) throw new Error("Expected a reviewed bill");
      const bill = await runCaregiverBilling(context, { operation: "submit", details: review.bill.details, submissionKey: review.submissionKey });
      if (!bill.ok || !("id" in bill)) throw new Error("Expected a submitted bill");
      return { ...setupResult, billId: bill.id };
    }

    it("sends a bill for approval as the organizer, raising its proposal from the bill's own amount", async () => {
      const { circle, snapshot, billId } = await submitted();
      const organizer = { db: db.app, userId: circle.userId, circle: await snapshot(circle.userId), accountTypes: "demo" as const };
      const sent = await runCaregiverBilling(organizer, { operation: "send", billId });
      expect(sent).toMatchObject({ ok: true });
      const after = await snapshot(circle.userId);
      expect(after.proposals.find((proposal) => proposal.billId === billId)).toMatchObject({ kind: "caregiver_payout", cents: 8800, state: "pending_approval" });
      expect(after.bills.find((bill) => bill.id === billId)?.state).toBe("proposed");
    });

    it("declines a bill as the organizer", async () => {
      const { circle, snapshot, billId } = await submitted();
      const organizer = { db: db.app, userId: circle.userId, circle: await snapshot(circle.userId), accountTypes: "demo" as const };
      expect(await runCaregiverBilling(organizer, { operation: "decline", billId })).toEqual({ ok: true, id: billId });
      expect((await snapshot(circle.userId)).bills.find((bill) => bill.id === billId)?.state).toBe("rejected");
    });

    it("refuses the caregiver, a caregiver's account, and forged or extra fields", async () => {
      const { circle, caregiver, snapshot, billId } = await submitted();
      expect(await runCaregiverBilling({ db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" }, { operation: "send", billId })).toEqual({ ok: false, reason: "refused" });
      const organizer = { db: db.app, userId: circle.userId, circle: await snapshot(circle.userId), accountTypes: ["caregiver" as const] };
      expect(await runCaregiverBilling(organizer, { operation: "send", billId })).toEqual({ ok: false, reason: "refused" });
      const family = { ...organizer, accountTypes: ["family_member" as const] };
      for (const input of [{ operation: "send", billId: "not-a-bill" }, { operation: "send", billId, cents: 1 }, { operation: "decline", billId, plan: {} }, { operation: "approve", billId }]) {
        expect(await runCaregiverBilling(family, input)).toEqual({ ok: false, reason: "invalid" });
      }
      expect(await runCaregiverBilling(family, { operation: "send", billId: crypto.randomUUID() })).toEqual({ ok: false, reason: "refused" });
    });
  });

  describe("reading a description of visits", () => {
    const text = "Monday 4 hours and Tuesday from 9 to 11.";
    const reply = visitsReply([
      { date: "2026-10-26", hours: 4, minutes: 0, quote: "Monday 4 hours" },
      { date: "2026-10-27", hours: 2, minutes: 0, quote: "Tuesday from 9 to 11" },
    ]);

    it("fills days from the caregiver's words, telling the model nothing about the rate or money", async () => {
      const { caregiver, snapshot } = await setup();
      const model = fakeModel(reply);
      const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const, model };
      expect(await runCaregiverBilling(context, { operation: "describe", description: text })).toEqual({
        ok: true,
        described: true,
        visits: [{ date: "2026-10-26", minutes: 240 }, { date: "2026-10-27", minutes: 120 }],
        unclear: [],
        dropped: 0,
      });
      const [request] = model.requests;
      expect(request?.system).toMatch(/Today is \w+day, 2026-10-30/);
      const asked = `${request?.system ?? ""}${request?.user ?? ""}`;
      for (const leak of ["2200", "22.00", "$", "Amara"]) expect(asked).not.toContain(leak);
    });

    it("says so when the model is absent, declines, or cannot be reached, and when the text cannot be read", async () => {
      const { caregiver, snapshot } = await setup();
      const base = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const };
      const describe = (context: object, description = text) => runCaregiverBilling({ ...base, ...context }, { operation: "describe", description });
      expect(await describe({ model: null })).toEqual({ ok: false, reason: "model_unavailable" });
      expect(await describe({ model: fakeModel({ kind: "refused" }) })).toEqual({ ok: false, reason: "model_refused" });
      expect(await describe({ model: fakeModel({ kind: "json", text: "nonsense" }) })).toEqual({ ok: false, reason: "model_unavailable" });
      expect(await describe({ model: fakeModel() }, "  ")).toEqual({ ok: false, reason: "description" });
      expect(await describe({ model: fakeModel() }, "x".repeat(1001))).toEqual({ ok: false, reason: "description" });
      expect(await runCaregiverBilling({ ...base, model: fakeModel() }, { operation: "describe", description: text, rate: 1 })).toEqual({ ok: false, reason: "invalid" });
    });

    it("limits how often one person asks, and lets only a caregiver ask", async () => {
      const { circle, caregiver, snapshot } = await setup();
      const limiter = createRateLimiter(1, 60_000);
      const context = { db: db.app, userId: caregiver, circle: await snapshot(caregiver), accountTypes: "demo" as const, model: fakeModel(reply, reply), limiter, now: () => 1_000 };
      expect(await runCaregiverBilling(context, { operation: "describe", description: text })).toMatchObject({ ok: true });
      expect(await runCaregiverBilling(context, { operation: "describe", description: text })).toEqual({ ok: false, reason: "busy" });
      expect(await runCaregiverBilling({ ...context, now: () => 61_001 }, { operation: "describe", description: text })).toMatchObject({ ok: true });
      const organizer = { db: db.app, userId: circle.userId, circle: await snapshot(circle.userId), accountTypes: "demo" as const, model: fakeModel(reply) };
      expect(await runCaregiverBilling(organizer, { operation: "describe", description: text })).toEqual({ ok: false, reason: "refused" });
    });
  });
});

