import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { PurseError, addPursePayee, answerPursePayment, cancelPursePayment, proposePursePayment, readPurse, readPursePayees, readPursePayments, setPurse, setPurseStatus, sharePursePayment, verifyPursePayee, type ProposePursePaymentInput } from "../purse.ts";
import { pursePayments } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof PurseError ? error.reason : `uncoded: ${String(error)}`;
  }
};

/** Everyone's seat in a demo circle, least-privileged first: Amara, Daniel, Marcus, Rose, and the visitor as Elena. */
async function seats(circle: VisitorCircle) {
  const [amara, daniel, marcus, rose] = await Promise.all([circle.members.amara, circle.members.daniel, circle.members.marcus, circle.members.rose].map((memberId) => seatPerson(db, circle.circleId, memberId)));
  return { amara: amara as string, daniel: daniel as string, marcus: marcus as string, rose: rose as string, elena: circle.userId };
}

async function payeeId(circle: VisitorCircle, userId: string, name: string): Promise<string> {
  const payees = await person(userId, (tx) => readPursePayees(tx, circle.circleId));
  const found = payees.find((payee) => payee.name === name);
  if (!found) throw new Error(`No ${name} in the address book`);
  return found.id;
}

const request = (circle: VisitorCircle, change: Partial<ProposePursePaymentInput> = {}): ProposePursePaymentInput => ({
  circleId: circle.circleId,
  payeeId: null,
  payeeName: "Lily",
  cents: 2_500,
  memo: "for her birthday",
  words: "Send Lily 25 dollars for her birthday.",
  route: "paypal",
  markers: [],
  holdReasons: [],
  readBack: "Send Lily $25.00 for her birthday, from your Purse?",
  readBackSource: "template",
  ...change,
});

const propose = (userId: string, input: ProposePursePaymentInput) => person(userId, (tx) => proposePursePayment(tx, input));
const answer = (userId: string, circle: VisitorCircle, paymentId: string, yes = true) =>
  person(userId, (tx) => answerPursePayment(tx, { circleId: circle.circleId, paymentId, answer: yes ? "yes" : "no", method: "app", evidence: "tap" }));
const visible = (userId: string, circle: VisitorCircle) => person(userId, async (tx) => (await readPursePayments(tx, circle.circleId)).map((payment) => payment.id));

/** Rose pays Lily: approved, and sealed. */
async function giftToLily(circle: VisitorCircle, rose: string): Promise<string> {
  const lily = await payeeId(circle, rose, "Lily");
  const { id } = await propose(rose, request(circle, { payeeId: lily }));
  expect(await answer(rose, circle, id)).toBe("approved");
  return id;
}

/** Rose is pressed into a payment to a stranger: held, and the family can see it. */
async function heldScam(circle: VisitorCircle, rose: string): Promise<string> {
  const { id } = await propose(
    rose,
    request(circle, { payeeName: "the man from the bank", cents: 50_000, words: "Send 500 dollars in gift cards to the man from the bank.", route: "gift_card", markers: ["gift_cards"], holdReasons: ["new_payee", "risky_route", "above_cap"] }),
  );
  expect(await answer(rose, circle, id)).toBe("held");
  return id;
}

describe("the parent's Purse is hers alone (AGENTS.md section 6)", () => {
  it("lets only the parent ask for a payment and answer it, least-privileged roles first", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const lily = await payeeId(circle, people.rose, "Lily");
    for (const userId of [people.amara, people.daniel, people.marcus, people.elena]) {
      expect(await reason(propose(userId, request(circle, { payeeId: lily })))).toBe("refused");
    }
    const { id } = await propose(people.rose, request(circle, { payeeId: lily }));
    for (const userId of [people.amara, people.daniel, people.marcus, people.elena]) {
      expect(await reason(answer(userId, circle, id))).toBe("refused");
      expect(await reason(person(userId, (tx) => sharePursePayment(tx, { circleId: circle.circleId, paymentId: id, share: true })))).toBe("refused");
    }
    expect(await answer(people.rose, circle, id)).toBe("approved");
  });

  it("seals each payment from the family, the observer included, until she shares it", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const gift = await giftToLily(circle, people.rose);
    expect(await visible(people.rose, circle)).toEqual([gift]);
    for (const userId of [people.amara, people.daniel, people.marcus, people.elena]) expect(await visible(userId, circle)).toEqual([]);
    // Not even a query that forgets its filter, or counts, sees it.
    expect(await person(people.elena, (tx) => countIn(tx, "purse_payments", circle.circleId))).toBe(0);

    await person(people.rose, (tx) => sharePursePayment(tx, { circleId: circle.circleId, paymentId: gift, share: true }));
    for (const userId of [people.daniel, people.marcus, people.elena]) expect(await visible(userId, circle)).toEqual([gift]);
    expect(await visible(people.amara, circle)).toEqual([]);

    await person(people.rose, (tx) => sharePursePayment(tx, { circleId: circle.circleId, paymentId: gift, share: false }));
    expect(await visible(people.elena, circle)).toEqual([]);
  });

  it("shows the family a payment that raised a flag, and never to a caregiver", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const held = await heldScam(circle, people.rose);
    for (const userId of [people.daniel, people.marcus, people.elena]) expect(await visible(userId, circle)).toEqual([held]);
    expect(await visible(people.amara, circle)).toEqual([]);
    expect(await person(people.amara, (tx) => readPurse(tx, circle.circleId))).toBeNull();
    expect(await person(people.amara, (tx) => readPursePayees(tx, circle.circleId))).toEqual([]);
  });

  it("lets the family cancel a held payment, never an observer or a caregiver, and never one that is not held", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const held = await heldScam(circle, people.rose);
    const cancel = (userId: string, paymentId: string) => person(userId, (tx) => cancelPursePayment(tx, { circleId: circle.circleId, paymentId, pressured: false }));
    expect(await reason(cancel(people.amara, held))).toBe("refused");
    expect(await reason(cancel(people.daniel, held))).toBe("refused");
    expect(await reason(cancel(people.marcus, held))).toBe("no error");
    expect(await reason(cancel(people.elena, held))).toBe("not_waiting");
    const gift = await giftToLily(circle, people.rose);
    expect(await reason(cancel(people.elena, gift))).toBe("not_waiting");
  });

  it("lets her say someone is telling her what to do: the payment stops at once and the family sees why", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const { id } = await propose(people.rose, request(circle, { payeeName: "the man from the bank", cents: 50_000, holdReasons: ["new_payee", "above_cap"] }));
    expect(await person(people.rose, (tx) => answerPursePayment(tx, { circleId: circle.circleId, paymentId: id, answer: "pressured", method: "app", evidence: "Yes, someone is telling me" }))).toBe("stopped");
    const seen = await person(people.elena, (tx) => readPursePayments(tx, circle.circleId));
    expect(seen.map((payment) => [payment.id, payment.state, payment.pressured, payment.cancelledBy])).toEqual([[id, "cancelled", true, circle.members.rose]]);
    // That answer is only for a payment Kin would hold, and only hers to give.
    const lily = await payeeId(circle, people.rose, "Lily");
    const plain = await propose(people.rose, request(circle, { payeeId: lily }));
    expect(await reason(person(people.rose, (tx) => answerPursePayment(tx, { circleId: circle.circleId, paymentId: plain.id, answer: "pressured", method: "app", evidence: "tap" })))).toBe("invalid");
    const held = await heldScam(circle, people.rose);
    await person(people.elena, (tx) => cancelPursePayment(tx, { circleId: circle.circleId, paymentId: held, pressured: true }));
    expect((await person(people.elena, (tx) => readPursePayments(tx, circle.circleId))).find((payment) => payment.id === held)?.pressured).toBe(false);
  });

  it("gives no person a way to write a payment except through her operations", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const gift = await giftToLily(circle, people.rose);
    for (const userId of [people.rose, people.elena]) {
      expect(await errorCode(person(userId, (tx) => tx.execute(sql`update purse_payments set cents = 1 where id = ${gift}`)))).toBe(REFUSED.permission);
      expect(await errorCode(person(userId, (tx) => tx.execute(sql`update purses set ceiling_cents = 1000000 where circle_id = ${circle.circleId}`)))).toBe(REFUSED.permission);
      expect(await errorCode(person(userId, (tx) => tx.execute(sql`update purse_payees set paypal_receiver = 'thief@example.com' where circle_id = ${circle.circleId}`)))).toBe(REFUSED.permission);
    }
  });
});

describe("another circle cannot reach a Purse", () => {
  it("cannot read another circle's Purse, address book or payments, nor write to them", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const people = await seats(theirs);
    const held = await heldScam(theirs, people.rose);
    for (const table of ["purses", "purse_payees", "purse_payments"]) {
      expect(await person(mine.userId, (tx) => countIn(tx, table, theirs.circleId))).toBe(0);
    }
    expect(await person(mine.userId, (tx) => readPurse(tx, theirs.circleId))).toBeNull();
    expect(await reason(person(mine.userId, (tx) => cancelPursePayment(tx, { circleId: theirs.circleId, paymentId: held, pressured: false })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => cancelPursePayment(tx, { circleId: mine.circleId, paymentId: held, pressured: false })))).toBe("not_waiting");
    expect(await reason(person(mine.userId, (tx) => setPurse(tx, { circleId: theirs.circleId, weeklyCents: 100, ceilingCents: 100, perPaymentCents: 100 })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => addPursePayee(tx, { circleId: theirs.circleId, name: "Thief", relationship: "friend", kind: "person", paypalReceiver: "thief@example.com" })))).toBe("refused");
    // Kin's service, acting for one circle, sees nothing of another.
    expect(await asService(db.service, mine.circleId, (tx) => countIn(tx, "purse_payments", theirs.circleId))).toBe(0);
    const moved = await asService(db.service, mine.circleId, (tx) => tx.update(pursePayments).set({ state: "cancelled" }).where(sql`circle_id = ${theirs.circleId}`).returning());
    expect(moved).toEqual([]);
  });
});

describe("the rules a payment keeps, whatever the app sends", () => {
  it("refuses a request that leaves out a reason to hold it, or that would not hold but is more than she has", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const lily = await payeeId(circle, people.rose, "Lily");
    const sam = await payeeId(circle, people.rose, "Sam");
    expect(await reason(propose(people.rose, request(circle, { payeeId: null, holdReasons: [] })))).toBe("unverified");
    expect(await reason(propose(people.rose, request(circle, { payeeId: sam })))).toBe("unverified");
    expect(await reason(propose(people.rose, request(circle, { payeeId: lily, cents: 4_001 })))).toBe("unverified");
    expect(await reason(propose(people.rose, request(circle, { payeeId: lily, cents: 4_001, holdReasons: ["above_cap"] })))).toBe("no error");
    // Fifty dollars is in the Purse; forty may go at once, twice that may not.
    const first = await propose(people.rose, request(circle, { payeeId: lily, cents: 4_000 }));
    expect(await answer(people.rose, circle, first.id)).toBe("approved");
    expect(await reason(propose(people.rose, request(circle, { payeeId: lily, cents: 1_500 })))).toBe("over_balance");
    const second = await propose(people.rose, request(circle, { payeeId: lily, cents: 1_000 }));
    expect(await answer(people.rose, circle, second.id)).toBe("approved");
  });

  it("never changes what she asked for, and never lowers a hold", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const held = await heldScam(circle, people.rose);
    const change = (set: Partial<typeof pursePayments.$inferInsert>) => errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`update purse_payments set ${sql.raw(Object.keys(set)[0] ?? "")} = ${Object.values(set)[0] as string} where id = ${held}`)));
    expect(await change({ cents: 100 })).toBe(REFUSED.permission);
    expect(await errorCode(db.admin.execute(sql`update purse_payments set hold_reasons = '{}' where id = ${held}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update purse_payments set cents = 100 where id = ${held}`))).toBe(REFUSED.restrict);
  });

  it("approves a held payment only once its hold has ended, to a verified payee", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const lily = await payeeId(circle, people.rose, "Lily");
    const { id } = await propose(people.rose, request(circle, { payeeId: lily, cents: 4_500, holdReasons: ["above_cap"] }));
    expect(await answer(people.rose, circle, id)).toBe("held");
    const approve = () => errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`update purse_payments set state = 'approved', receiver = 'lily@personal.example.com' where id = ${id}`)));
    expect(await approve()).toBe(REFUSED.restrict);
    await db.admin.execute(sql`update circles set clock_at = clock_at + interval '25 hours' where id = ${circle.circleId}`);
    expect(await approve()).toBe("no error");
    const scam = await heldScam(circle, people.rose);
    await db.admin.execute(sql`update circles set clock_at = clock_at + interval '25 hours' where id = ${circle.circleId}`);
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`update purse_payments set state = 'approved', receiver = 'man@example.com' where id = ${scam}`)))).toBe(REFUSED.restrict);
  });

  it("refuses spending while the circle is paused", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const lily = await payeeId(circle, people.rose, "Lily");
    const { id } = await propose(people.rose, request(circle, { payeeId: lily }));
    await db.admin.execute(sql`update circles set paused_until = clock_at + interval '1 day', paused_by = ${circle.members.marcus} where id = ${circle.circleId}`);
    expect(await reason(answer(people.rose, circle, id))).toBe("paused");
    expect(await reason(propose(people.rose, request(circle, { payeeId: lily })))).toBe("paused");
  });
});

describe("the address book and the Purse's terms", () => {
  it("is verified by someone who answers for the family and did not add the entry", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const verify = (userId: string, id: string) => person(userId, (tx) => verifyPursePayee(tx, circle.circleId, id));
    const added = await person(people.marcus, (tx) => addPursePayee(tx, { circleId: circle.circleId, name: "Grace", relationship: "neighbour", kind: "person", paypalReceiver: "Grace@Example.com" }));
    expect(await reason(person(people.amara, (tx) => addPursePayee(tx, { circleId: circle.circleId, name: "Mallory", relationship: "friend", kind: "person", paypalReceiver: "m@example.com" })))).toBe("refused");
    expect(await reason(person(people.daniel, (tx) => addPursePayee(tx, { circleId: circle.circleId, name: "Mallory", relationship: "friend", kind: "person", paypalReceiver: "m@example.com" })))).toBe("refused");
    for (const userId of [people.amara, people.daniel, people.rose]) expect(await reason(verify(userId, added))).toBe("refused");
    expect(await reason(verify(people.marcus, added))).toBe("own_entry");
    expect(await reason(verify(people.elena, added))).toBe("no error");
    expect(await reason(verify(people.elena, added))).toBe("not_waiting");
    const grace = (await person(people.rose, (tx) => readPursePayees(tx, circle.circleId))).find((payee) => payee.id === added);
    expect(grace).toMatchObject({ paypalReceiver: "grace@example.com", verifiedBy: circle.members.elena });
  });

  it("is set up by the organizer alone, never above the agreement's ceiling, and paused by anyone who answers for the family", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const terms = { circleId: circle.circleId, weeklyCents: 2_000, ceilingCents: 8_000, perPaymentCents: 3_000 };
    for (const userId of [people.amara, people.daniel, people.marcus, people.rose]) expect(await reason(person(userId, (tx) => setPurse(tx, terms)))).toBe("refused");
    expect(await reason(person(people.elena, (tx) => setPurse(tx, { ...terms, ceilingCents: 10_000_000 })))).toBe("above_agreement");
    expect(await reason(person(people.elena, (tx) => setPurse(tx, terms)))).toBe("no error");
    expect(await person(people.rose, (tx) => readPurse(tx, circle.circleId))).toMatchObject({ weeklyCents: 2_000, ceilingCents: 8_000, perPaymentCents: 3_000, status: "active" });
    for (const userId of [people.amara, people.daniel]) expect(await reason(person(userId, (tx) => setPurseStatus(tx, circle.circleId, "paused")))).toBe("refused");
    expect(await reason(person(people.rose, (tx) => setPurseStatus(tx, circle.circleId, "paused")))).toBe("no error");
    expect(await reason(person(people.marcus, (tx) => setPurseStatus(tx, circle.circleId, "active")))).toBe("refused");
    expect(await reason(person(people.elena, (tx) => setPurseStatus(tx, circle.circleId, "active")))).toBe("no error");
  });
});
