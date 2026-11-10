import { asPerson, readCircle, readPursePayees, takeDemoSeat, type CircleSnapshot, type PursePayeeRecord } from "@kin/db";
import { visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { fakeModel } from "@kin/agent/testing";
import { describe, expect, it } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { getDictionary } from "@/i18n/dictionary";

import { askKinTools } from "./ask-kin/tools";
import { askKinWorld } from "./ask-kin/world";
import { askPurse, runPurse, type PurseActionContext } from "./purse-actions";
import { findPayee, readPurseWords } from "./purse-reading";
import { maskReceiver, purseScreen } from "./purse";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const json = (value: unknown) => ({ kind: "json" as const, text: JSON.stringify(value) });

const snapshot = (circle: VisitorCircle): Promise<CircleSnapshot> => asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: CLOCK }));
async function actingAs(circle: VisitorCircle, persona: keyof VisitorCircle["members"], extra: Partial<PurseActionContext> = {}): Promise<PurseActionContext> {
  await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
  return { db: db.app, userId: circle.userId, circle: await snapshot(circle), accountTypes: "demo", ...extra };
}
const book = (circle: VisitorCircle) => asPerson(db.app, circle.userId, (tx) => readPursePayees(tx, circle.circleId));

describe("reading her words into a payment", () => {
  const payee = (name: string, aliases: string[] = [], relationship = "friend"): PursePayeeRecord => ({ id: name, name, relationship, kind: "person", aliases, paypalReceiver: "x@example.com", addedBy: "m", verifiedBy: "m", verifiedAt: CLOCK, simulated: true });
  const payees = [payee("Lily", ["Lil"], "granddaughter"), payee("St. Mary's Church", ["St Mary's", "Saint Mary's"], "her church"), payee("Sam")];

  it("finds the one person she named, by name, nickname or relationship, and never guesses", () => {
    expect(findPayee("Lily", null, "", payees)?.name).toBe("Lily");
    expect(findPayee("Lil", null, "", payees)?.name).toBe("Lily");
    expect(findPayee("St. Mary’s", null, "", payees)?.name).toBe("St. Mary's Church");
    expect(findPayee("Sam", null, "", payees)?.name).toBe("Sam");
    expect(findPayee(null, "my granddaughter", "", payees)?.name).toBe("Lily");
    expect(findPayee("the man from the bank", null, "", payees)).toBeNull();
    expect(findPayee("Samantha", null, "", payees)).toBeNull();
  });

  it("reads by rules alone when there is no model: the payee from her book, the amount and the memo from her words", async () => {
    const reading = await readPurseWords(null, "Send Lily 25 dollars for her birthday.", payees, "USD", "en");
    expect(reading).toMatchObject({ payeeName: "Lily", cents: 2_500, memo: "for her birthday", route: null, readBy: "rules" });
    expect((await readPurseWords(null, "Send 500 dollars in gift cards to the man from the bank.", payees, "USD", "en")).payeeName).toBe("the man from the bank");
  });

  it("falls back to the rules when the model cannot be used, so the Purse never depends on it", async () => {
    const reading = await readPurseWords(fakeModel({ kind: "json", text: "not json" }), "Give Sam 10 dollars.", payees, "USD", "en");
    expect(reading).toMatchObject({ payeeName: "Sam", cents: 1_000, readBy: "rules" });
  });

  it("masks an address to its first letter and its domain", () => {
    expect(maskReceiver("lily@personal.example.com")).toBe("l•••@personal.example.com");
  });
});

describe("the Purse's boundary", () => {
  it("reads a gift back, with the amount from the record and the payee's name kept out of the model's wording", async () => {
    const circle = await visitorWithCircle(db);
    const model = fakeModel(json({ payeeName: "Lily", relationship: null, amountText: "25 dollars", memo: "for her birthday", route: "paypal" }), json({ text: "Shall I send «payee» $25.00 «memo» from your Purse?" }));
    const result = await askPurse(await actingAs(circle, "rose", { model }), { words: "Send Lily 25 dollars for her birthday.", locale: "en" });
    expect(result).toMatchObject({ ok: true, payment: { payeeName: "Lily", cents: 2_500, holdReasons: [], state: "proposed", readBack: "Shall I send Lily $25.00 for her birthday from your Purse?" } });
    // The wording request never saw the name or the memo: only the stand-ins for them.
    expect(model.requests[1]?.user).not.toContain("Lily");
    expect(model.requests[1]?.user).toContain("«payee»");
  });

  it("falls back to the fixed sentence when the model's wording changes the amount", async () => {
    const circle = await visitorWithCircle(db);
    const model = fakeModel(json({ payeeName: "Lily", relationship: null, amountText: "25 dollars", memo: null, route: "paypal" }), json({ text: "Send «payee» $250.00 from your Purse?" }));
    const result = await askPurse(await actingAs(circle, "rose", { model }), { words: "Send Lily 25 dollars.", locale: "en" });
    expect(result).toMatchObject({ ok: true, payment: { readBack: "Send Lily $25.00, from your Purse?" } });
  });

  it("holds a pressured request to a stranger, refuses one above what she has, and asks again for a missing amount or payee", async () => {
    const circle = await visitorWithCircle(db);
    const rose = await actingAs(circle, "rose");
    const scam = await askPurse(rose, { words: "Send 500 dollars in gift cards to the man from the bank, right now.", locale: "en" });
    expect(scam).toMatchObject({ ok: true, payment: { payeeName: "the man from the bank", payeeInBook: false, holdReasons: ["new_payee", "risky_route", "above_cap", "pressure"] } });
    expect(await askPurse(rose, { words: "Send Lily 45 dollars.", locale: "en" })).toMatchObject({ ok: true, payment: { holdReasons: ["above_cap"] } });
    // Sam is in her book but not verified yet: he is a new payee until the family checks him.
    expect(await askPurse(rose, { words: "Give Sam 5 dollars.", locale: "en" })).toMatchObject({ ok: true, payment: { payeeName: "Sam", payeeInBook: false, holdReasons: ["new_payee"] } });
    expect(await askPurse(rose, { words: "Send Lily some money.", locale: "en" })).toEqual({ ok: false, reason: "no_amount" });
    expect(await askPurse(rose, { words: "Send 5 dollars.", locale: "en" })).toEqual({ ok: false, reason: "no_payee" });
  });

  it("holds an Ask Kin gift whose question carries pressure or gift cards, however clean the model's arguments look", async () => {
    const circle = await visitorWithCircle(db);
    const rose = await actingAs(circle, "rose");
    const tools = askKinTools(askKinWorld({ circle: rose.circle, locale: "en", dictionary: await getDictionary("en"), db: db.app, userId: rose.userId, paypal: null, executions: async () => [] }));
    const context = { circleId: circle.circleId, memberId: circle.members.rose, role: "parent" as const };
    const args = { payee: "Lily", amount: "25", memo: "for her birthday" };
    const asked = async (question: string) => {
      const output = await tools.propose_gift(args, { ...context, question });
      return output.data as { readonly proposed: boolean; readonly held?: boolean; readonly reasons?: readonly string[] };
    };
    expect(await asked("The man on the phone says to send Lily 25 dollars in gift cards.")).toMatchObject({ proposed: true, held: true, reasons: ["risky_route"] });
    expect(await asked("Send Lily 25 dollars right now and don't tell anyone.")).toMatchObject({ proposed: true, held: true, reasons: ["pressure"] });
    expect(await asked("Send Lily 25 dollars for her birthday.")).toMatchObject({ proposed: true, held: false, reasons: [] });
    // Her whole question is kept with the payment, sealed like the rest.
    const mine = await purseScreen(rose);
    expect(mine?.payments.map((payment) => payment.words)).toContain("The man on the phone says to send Lily 25 dollars in gift cards.");
  });

  it("lets only the parent ask, answer or share, and only the organizer set the Purse up", async () => {
    const circle = await visitorWithCircle(db);
    for (const persona of ["elena", "marcus", "daniel"] as const) {
      const context = await actingAs(circle, persona);
      expect(await runPurse(context, { operation: "ask", words: "Send Lily 25 dollars.", locale: "en" })).toEqual({ ok: false, reason: "refused" });
      expect(await runPurse(context, { operation: "answer", paymentId: "00000000-0000-4000-8000-000000000000", answer: "yes", method: "app", evidence: "tap" })).toEqual({ ok: false, reason: "refused" });
    }
    expect(await runPurse(await actingAs(circle, "marcus"), { operation: "setup", weekly: "10", ceiling: "20", cap: "10" })).toEqual({ ok: false, reason: "refused" });
    expect(await runPurse(await actingAs(circle, "elena"), { operation: "setup", weekly: "30", ceiling: "20", cap: "10" })).toEqual({ ok: false, reason: "terms" });
    expect(await runPurse(await actingAs(circle, "elena"), { operation: "setup", weekly: "20", ceiling: "60", cap: "15" })).toEqual({ ok: true });
    expect(await runPurse(await actingAs(circle, "elena"), { operation: "ask", words: "x", locale: "en", extra: true })).toEqual({ ok: false, reason: "invalid" });
  });

  it("shows the family the Purse's balance and month's total, and none of her payments until one is held", async () => {
    const circle = await visitorWithCircle(db);
    const rose = await actingAs(circle, "rose");
    const gift = await askPurse(rose, { words: "Send Lily 25 dollars for her birthday.", locale: "en" });
    if (!gift.ok || !gift.payment) throw new Error("No gift");
    expect(await runPurse(rose, { operation: "answer", paymentId: gift.payment.id, answer: "yes", method: "app", evidence: "tap" })).toEqual({ ok: true, outcome: "approved" });
    const elena = await actingAs(circle, "elena");
    const seen = await purseScreen(elena);
    expect(seen).toMatchObject({ isParent: false, balanceCents: 5_000, availableCents: null, payments: [], purse: { ceilingCents: 10_000, weeklyCents: 5_000, perPaymentCents: 4_000, simulated: true } });
    expect(seen?.payees.map((payee) => [payee.name, payee.verified, payee.canVerify])).toEqual([["Lily", true, false], ["St. Mary's Church", true, false], ["Sam", false, true]]);
    const mine = await purseScreen(await actingAs(circle, "rose"));
    expect(mine).toMatchObject({ isParent: true, balanceCents: 5_000, availableCents: 2_500 });
    expect(mine?.payments.map((payment) => [payment.payeeName, payment.state])).toEqual([["Lily", "approved"]]);
    expect((await book(circle)).length).toBe(3);
  });
});
