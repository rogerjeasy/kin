import { fakeToolModel, finalTurn, toolCalls, type FakeToolModel } from "@kin/agent/testing";
import type { ToolCallRecord, ToolTurn } from "@kin/agent";
import { asPerson, readCircle, readExecutions, type CircleSnapshot } from "@kin/db";
import { endMandates, seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../model";
import { runAskKin, type AskKinContext } from "./ask-kin";
import { askKinTools } from "./tools";
import { askKinWorld } from "./world";
import { openPeriod } from "@/content/circle/period";
import { spendingByCategory } from "@/content/circle/record";
import { getDictionary } from "@/i18n/dictionary";
import { testDatabases } from "../../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();
const NOW = new Date("2026-10-30T18:00:00Z");

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: NOW }));

function context(circle: CircleSnapshot, userId: string, model: FakeToolModel | null, records: ToolCallRecord[] = []): AskKinContext {
  return { db: db.app, userId, circle, accountTypes: "demo", model, paypal: null, recorder: (record) => records.push(record), limiter: createRateLimiter(10, 3_600_000), budget: createRateLimiter(100, 3_600_000), now: () => 1_000 };
}

/** What a tool handed the model, as the model read it. */
function toolResult(model: FakeToolModel, request: number): unknown {
  const last = model.requests[request]?.messages.at(-1);
  const blocks = Array.isArray(last?.content) ? last.content : [];
  const [first] = blocks as readonly { content: string }[];
  return first === undefined ? null : JSON.parse(first.content);
}

const ask = (question: string) => ({ question, locale: "en" });
const turns = (...list: ToolTurn[]) => fakeToolModel(...list);

describe("Ask Kin in a demo circle", () => {
  it("answers whether the caregiver was paid from the record, through the payout tool, and shows the trace", async () => {
    const circle = await visitorWithCircle(db);
    const records: ToolCallRecord[] = [];
    const model = turns(toolCalls({ name: "get_paypal_payout_status", input: { payee: "Amara" } }), finalTurn("Yes: Amara was paid $264.00 on Oct 6. It was simulated."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model, records), ask("Has Amara been paid?"));

    expect(result).toEqual({
      ok: true,
      answer: "Yes: Amara was paid $264.00 on Oct 6. It was simulated.",
      source: "claude",
      templateReason: null,
      model: "fake-model",
      steps: [{ tool: "get_paypal_payout_status", label: "Checked the payouts with PayPal", outcome: "ok", outcomeLabel: "done" }],
      proposal: null,
      // Nobody's questions are counted in this context: no demo allowance was given.
      questionsLeft: null,
    });
    expect(toolResult(model, 1)).toMatchObject({ paid: [{ to: "Amara", amount: "$264.00", day: "Oct 6", simulated: true, paypal: "simulated: no PayPal transaction stands behind it" }] });
    expect(records).toMatchObject([{ tool: "get_paypal_payout_status", args: { payee: "[text:5]" }, outcome: "ok" }]);
  });

  it("hands the model the money core's fairness and the pool's figures, never anything it computed", async () => {
    const circle = await visitorWithCircle(db);
    const model = turns(toolCalls({ name: "get_fairness" }, { name: "get_pool" }), finalTurn("Here is the month."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model), ask("Who owes whom this month?"));
    expect(result).toMatchObject({ ok: true, source: "claude", steps: [{ tool: "get_fairness", outcome: "ok" }, { tool: "get_pool", outcome: "ok" }] });
    const last = model.requests[1]?.messages.at(-1);
    const [fairness, pool] = (Array.isArray(last?.content) ? last.content : []).map((block) => JSON.parse((block as { content: string }).content) as Record<string, unknown>);
    expect(fairness).toMatchObject({ month: "October 2026", simulated: true });
    expect((fairness?.members as { member: string }[]).map((each) => each.member).toSorted()).toEqual(["Ana", "Elena", "Marcus"]);
    expect(pool).toMatchObject({ month: "October 2026", simulated: true });
    expect(pool?.pool).toMatch(/^\$[\d,]+\.\d{2}$/u);
  });

  it("checks a demand with the plain-code claim check, and records nothing and alerts nobody", async () => {
    const circle = await visitorWithCircle(db);
    const before = await serviceRows(db, circle.circleId, "select count(*)::int as n from claim_checks where circle_id = $1", [circle.circleId]);
    const model = turns(toolCalls({ name: "check_claim", input: { payee: "Harbor Gas", amount: "300" } }), finalTurn("Nobody the circle pays is called Harbor Gas, so do not pay the $300.00."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model), ask("Is a $300 demand from Harbor Gas real?"));
    expect(result).toMatchObject({ ok: true, source: "claude" });
    expect(toolResult(model, 1)).toMatchObject({ claimedPayee: "Harbor Gas", claimedAmount: "$300.00", verdict: "no_match", reason: "unknown_payee" });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from claim_checks where circle_id = $1", [circle.circleId])).toEqual(before);
  });

  it("falls back to Kin's fixed wording when the model's figure is not the record's", async () => {
    const circle = await visitorWithCircle(db);
    const model = turns(toolCalls({ name: "get_paypal_payout_status", input: { payee: "Amara" } }), finalTurn("Amara was paid $246.00."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model), ask("Has Amara been paid?"));
    expect(result).toMatchObject({ ok: true, source: "template", templateReason: "guard", answer: "Here is what the record says: Amara was paid $264.00 on Oct 6. It was simulated." });
  });

  it("tells the model what the month's spending went on, from the same figures as the overview", async () => {
    const circle = await visitorWithCircle(db);
    const read = await snapshot(circle, circle.userId);
    const model = turns(toolCalls({ name: "get_pool" }), finalTurn("Here is the month."));
    await runAskKin(context(read, circle.userId, model), ask("What did the family spend on pharmacy this month?"));
    const pool = toolResult(model, 1) as { spentThisMonthByCategory: { category: string; amount: string }[] };
    const expected = spendingByCategory(read, openPeriod(read)).map((row) => row.cents);
    expect(pool.spentThisMonthByCategory).toHaveLength(expected.length);
    expect(pool.spentThisMonthByCategory.every((row) => /^\$[\d,]+\.\d{2}$/u.test(row.amount))).toBe(true);
  });

  it("lets the parent's question raise a refill proposal that waits for a yes, at the rule's price", async () => {
    const circle = await visitorWithCircle(db);
    // The demo's standing permission would approve it at once; without it the refill truly waits.
    await endMandates(db, circle.circleId);
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    const model = turns(toolCalls({ name: "propose_refill", input: { item: "refill" } }), finalTurn("Kin proposed the refill."));
    const result = await runAskKin(context(await snapshot(circle, rose), rose, model), ask("Reorder my refill"));
    expect(result).toMatchObject({ ok: true, proposal: { href: "/dashboard/approvals" }, steps: [{ tool: "propose_refill", outcome: "ok" }] });
    expect(toolResult(model, 1)).toMatchObject({ proposed: true, item: "Monthly prescription refill (30 days)", price: "$64.00" });
    expect(await serviceRows(db, circle.circleId, "select cents::int as cents from purchases where circle_id = $1", [circle.circleId])).toEqual([{ cents: 6400 }]);
  });

  it("says a refill the parent's standing permission covers was approved and ordered, not that it waits, as the card under the answer", async () => {
    const circle = await visitorWithCircle(db);
    const model = turns(toolCalls({ name: "propose_refill", input: {} }), finalTurn("Rose's standing permission approved the refill at $64.00, and the order is being placed."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model), ask("Reorder Rose's refill"));
    const [proposal] = await serviceRows(db, circle.circleId, "select id, state from proposals where circle_id = $1 and kind = 'purchase'", [circle.circleId]);
    expect(proposal).toMatchObject({ state: "approved" });
    expect(result).toMatchObject({
      ok: true,
      source: "claude",
      proposal: { kind: "standing_permission", href: `/dashboard/approvals#${String(proposal?.id)}`, words: { parent: "Rose", amount: "$64.00", seller: "Elm Street Pharmacy" } },
    });
    // Nothing is charged while Kin answers, so the model is told neither "simulated" nor "sandbox" as a fact about this payment.
    expect(toolResult(model, 1)).toMatchObject({ proposed: true, price: "$64.00", seller: "Elm Street Pharmacy", parent: "Rose", approval: expect.stringContaining("Kin did not approve it"), charged: expect.stringMatching(/^not charged yet/u) });
    expect(toolResult(model, 1)).not.toHaveProperty("simulated");
    expect(JSON.stringify(toolResult(model, 1))).not.toMatch(/waits|waiting/u);
  });

  it("says a refill outside the standing permission waits for a yes, and the card says so", async () => {
    const circle = await visitorWithCircle(db);
    await endMandates(db, circle.circleId);
    const model = turns(toolCalls({ name: "propose_refill", input: {} }), finalTurn("Kin proposed the refill at $64.00. It waits for the family's yes."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model), ask("Reorder Rose's refill"));
    expect(result).toMatchObject({ ok: true, source: "claude", proposal: { kind: "proposal", href: "/dashboard/approvals" } });
    expect(toolResult(model, 1)).toMatchObject({ proposed: true, price: "$64.00", approval: expect.stringContaining("waiting for the yeses") });
    expect(await serviceRows(db, circle.circleId, "select state from proposals where circle_id = $1 and kind = 'purchase'", [circle.circleId])).toEqual([{ state: "pending_approval" }]);
  });

  it("falls back to the record's own sentence for a covered refill, which names who approved it", async () => {
    const circle = await visitorWithCircle(db);
    const model = turns(toolCalls({ name: "propose_refill", input: {} }), finalTurn("Kin approved the refill at $46.00."));
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, model), ask("Reorder Rose's refill"));
    expect(result).toMatchObject({
      ok: true,
      source: "template",
      templateReason: "guard",
      answer: "Here is what the record says: Rose's standing permission approved Monthly prescription refill (30 days) at $64.00 from Elm Street Pharmacy, so nobody needs to say yes, and the order is being placed. Kin did not approve it.",
      proposal: { kind: "standing_permission" },
    });
  });

  it("reorders the circle's only refill when the model passes the parent's name as the item, as Opus 4.6 did live", async () => {
    const circle = await visitorWithCircle(db);
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    const model = turns(toolCalls({ name: "propose_refill", input: { item: "Rose" } }), finalTurn("Kin proposed the refill."));
    const result = await runAskKin(context(await snapshot(circle, rose), rose, model), ask("Reorder Rose's refill"));
    expect(result).toMatchObject({ ok: true, steps: [{ tool: "propose_refill", outcome: "ok", label: "Proposed a refill" }] });
    expect(toolResult(model, 1)).toMatchObject({ proposed: true, item: "Monthly prescription refill (30 days)" });
  });

  it("reorders the circle's only refill when the parent names it in her own words", async () => {
    const circle = await visitorWithCircle(db);
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    const model = turns(toolCalls({ name: "propose_refill", input: { item: "Rose's refill" } }), finalTurn("Kin proposed the refill."));
    const result = await runAskKin(context(await snapshot(circle, rose), rose, model), ask("Reorder Rose's refill"));
    expect(result).toMatchObject({ ok: true, steps: [{ tool: "propose_refill", outcome: "ok", label: "Proposed a refill" }] });
    expect(toolResult(model, 1)).toMatchObject({ proposed: true, item: "Monthly prescription refill (30 days)" });
  });

  it("never claims a refill it did not propose: an item no rule names is asked about, and the trace says nothing was proposed", async () => {
    const circle = await visitorWithCircle(db);
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    const model = turns(toolCalls({ name: "propose_refill", input: { item: "insulin pens" } }), finalTurn("Which refill do you mean?"));
    const result = await runAskKin(context(await snapshot(circle, rose), rose, model), ask("Reorder her insulin pens"));
    expect(result).toMatchObject({ ok: true, proposal: null, steps: [{ tool: "propose_refill", outcome: "ok", label: "Looked at the refills: nothing was proposed" }] });
    expect(toolResult(model, 1)).toMatchObject({ proposed: false });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from purchases where circle_id = $1", [circle.circleId])).toEqual([{ n: 0 }]);
  });
});

describe("Ask Kin's limits by role", () => {
  it("offers a caregiver only their own payments, refuses the pool, and shows only their own payouts", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const model = turns(toolCalls({ name: "get_pool" }, { name: "get_paypal_payout_status" }), finalTurn("Kin cannot show the pool from your seat."));
    const result = await runAskKin(context(await snapshot(circle, amara), amara, model), ask("How much is in the pool, and have I been paid?"));
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(["list_bills", "list_proposals", "get_paypal_payout_status"]);
    expect(result).toMatchObject({ ok: true, steps: [{ tool: "get_pool", outcome: "refused" }, { tool: "get_paypal_payout_status", outcome: "ok" }] });
    const last = model.requests[1]?.messages.at(-1);
    const payouts = JSON.parse(((Array.isArray(last?.content) ? last.content : [])[1] as { content: string }).content) as { paid: { to: string }[] };
    expect(payouts.paid.map((each) => each.to)).toEqual(["Amara"]);
  });

  it("refuses an observer's refill, and nothing is bought", async () => {
    const circle = await visitorWithCircle(db);
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    const model = turns(toolCalls({ name: "propose_refill" }), finalTurn("Kin cannot do that from your seat."));
    const result = await runAskKin(context(await snapshot(circle, daniel), daniel, model), ask("Reorder Rose's refill"));
    expect(model.requests[0]?.tools.map((tool) => tool.name)).not.toContain("propose_refill");
    expect(result).toMatchObject({ ok: true, proposal: null, steps: [{ tool: "propose_refill", outcome: "refused" }] });
    expect(await serviceRows(db, circle.circleId, "select count(*)::int as n from purchases where circle_id = $1", [circle.circleId])).toEqual([{ n: 0 }]);
  });
});

describe("one circle's Ask Kin and another's", () => {
  it("cannot be pointed at another circle, by the model or by a context", async () => {
    const mine = await visitorWithCircle(db);
    const theirs = await visitorWithCircle(db);
    const model = turns(toolCalls({ name: "get_pool", input: { circleId: theirs.circleId } }), finalTurn("No."));
    const result = await runAskKin(context(await snapshot(mine, mine.userId), mine.userId, model), ask("What is in the other circle's pool?"));
    expect(result).toMatchObject({ ok: true, steps: [{ tool: "get_pool", outcome: "invalid" }] });

    const tools = askKinTools(
      askKinWorld({ circle: await snapshot(mine, mine.userId), locale: "en", dictionary: await getDictionary("en"), db: db.app, userId: mine.userId, paypal: null, executions: async () => [] }),
    );
    await expect(tools.get_pool({}, { circleId: theirs.circleId, memberId: theirs.members.elena, role: "organizer" })).rejects.toThrow(/another circle/u);
  });

  it("reads executions through row-level security: another circle's never come back", async () => {
    const mine = await visitorWithCircle(db);
    const theirs = await visitorWithCircle(db);
    const [proposal] = await serviceRows(db, theirs.circleId, "select id from proposals where circle_id = $1 and purpose = 'stairlift' limit 1", [theirs.circleId]);
    // Amara's two paid shifts come with their executions already.
    const before = (await asPerson(db.app, theirs.userId, (tx) => readExecutions(tx, theirs.circleId))).length;
    await serviceRows(db, theirs.circleId, "insert into executions (id, circle_id, proposal_id, idempotency_key, state) values (gen_random_uuid(), $1, $2, $3, 'created')", [theirs.circleId, proposal?.id, `test-${theirs.circleId}`]);
    expect(await asPerson(db.app, theirs.userId, (tx) => readExecutions(tx, theirs.circleId))).toHaveLength(before + 1);
    expect(await asPerson(db.app, mine.userId, (tx) => readExecutions(tx, theirs.circleId))).toEqual([]);
  });
});

describe("Ask Kin's request boundary", () => {
  it("refuses a malformed request before the model is asked", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const model = turns();
    for (const bad of [null, {}, { question: "" }, { question: "x".repeat(501), locale: "en" }, { question: "Hi", locale: "xx" }, { question: "Hi", locale: "en", extra: 1 }, { question: "Hi", locale: "en", history: [{ question: "a" }] }, { question: "Hi", locale: "en", history: Array.from({ length: 7 }, () => ({ question: "a", answer: "b" })) }]) {
      expect(await runAskKin(context(seen, circle.userId, model), bad)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(model.requests).toEqual([]);
  });

  it("is unavailable without a model, and busy once the person's limit is spent", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    expect(await runAskKin(context(seen, circle.userId, null), ask("Hi"))).toEqual({ ok: false, reason: "unavailable" });
    const limiter = createRateLimiter(1, 3_600_000);
    const model = turns(finalTurn("Hello."));
    expect(await runAskKin({ ...context(seen, circle.userId, model), limiter }, ask("Hi"))).toMatchObject({ ok: true });
    expect(await runAskKin({ ...context(seen, circle.userId, model), limiter }, ask("Hi again"))).toEqual({ ok: false, reason: "busy" });
  });
});

describe("a demo visitor's questions", () => {
  const answers = (count: number) => turns(...Array.from({ length: count }, (_, index) => finalTurn(`Answer ${index + 1}.`)));

  it("are counted down with each answer, and the sixth is refused before the model is asked", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const questions = createRateLimiter(5, 14 * 86_400_000);
    const model = answers(6);
    const left: (number | null)[] = [];
    for (let index = 0; index < 5; index++) {
      const result = await runAskKin({ ...context(seen, circle.userId, model), questions }, ask(`Question ${index + 1}`));
      if (!result.ok) throw new Error(`question ${index + 1} was refused: ${result.reason}`);
      left.push(result.questionsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await runAskKin({ ...context(seen, circle.userId, model), questions }, ask("Question 6"))).toEqual({ ok: false, reason: "demo_limit" });
    expect(model.requests).toHaveLength(5);
  });

  it("belong to the visitor: another visitor still has all of theirs", async () => {
    const first = await visitorWithCircle(db);
    const second = await visitorWithCircle(db);
    const questions = createRateLimiter(1, 14 * 86_400_000);
    const model = answers(2);
    expect(await runAskKin({ ...context(await snapshot(first, first.userId), first.userId, model), questions }, ask("Hi"))).toMatchObject({ ok: true, questionsLeft: 0 });
    expect(await runAskKin({ ...context(await snapshot(first, first.userId), first.userId, model), questions }, ask("Hi again"))).toEqual({ ok: false, reason: "demo_limit" });
    expect(await runAskKin({ ...context(await snapshot(second, second.userId), second.userId, model), questions }, ask("Hi"))).toMatchObject({ ok: true, questionsLeft: 0 });
  });

  it("are not spent by a question the hourly limit refuses, and the demo limit spends no hourly use", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const questions = createRateLimiter(1, 14 * 86_400_000);
    const limiter = createRateLimiter(1, 3_600_000);
    limiter.record(circle.userId, 1_000);
    expect(await runAskKin({ ...context(seen, circle.userId, answers(1)), questions, limiter }, ask("Hi"))).toEqual({ ok: false, reason: "busy" });
    expect(questions.used(circle.userId, 1_000)).toBe(0);

    const spent = createRateLimiter(1, 14 * 86_400_000);
    spent.record(circle.userId, 1_000);
    const hourly = createRateLimiter(10, 3_600_000);
    expect(await runAskKin({ ...context(seen, circle.userId, answers(1)), questions: spent, limiter: hourly }, ask("Hi"))).toEqual({ ok: false, reason: "demo_limit" });
    expect(hourly.used(circle.userId, 1_000)).toBe(0);
  });

  it("are not counted for a person who signed in: no allowance, and no count is reported", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const model = answers(7);
    for (let index = 0; index < 7; index++) {
      expect(await runAskKin(context(seen, circle.userId, model), ask(`Question ${index + 1}`))).toMatchObject({ ok: true, questionsLeft: null });
    }
  });
});

describe("Ask Kin when Claude is unavailable", () => {
  // A fake with no turns left fails on its first request, as Bedrock does when it throttles past the SDK's retries.
  const down = () => turns();

  it("answers each suggested question with Kin's own routing and fixed wording, and says Claude was unavailable", async () => {
    const circle = await visitorWithCircle(db);
    const seen = await snapshot(circle, circle.userId);
    const asked = [
      ["Has Amara been paid?", "get_paypal_payout_status", "Amara was paid"],
      ["Who owes whom this month?", "get_fairness", "by the agreement's shares"],
      ["Is a $300.00 demand from Harbor Gas real?", "check_claim", "Nobody the circle pays is called Harbor Gas"],
    ] as const;
    for (const [question, tool, words] of asked) {
      const result = await runAskKin(context(seen, circle.userId, down()), ask(question));
      expect(result).toMatchObject({ ok: true, source: "template", templateReason: "no_claude", steps: [{ tool, outcome: "ok" }] });
      expect(result.ok && result.answer).toContain(words);
    }
  });

  it("reorders the parent's refill without Claude, and the proposal still waits for a yes", async () => {
    const circle = await visitorWithCircle(db);
    // The demo's standing permission would approve it at once; without it the refill truly waits.
    await endMandates(db, circle.circleId);
    const rose = await seatPerson(db, circle.circleId, circle.members.rose);
    const result = await runAskKin(context(await snapshot(circle, rose), rose, down()), ask("Reorder Rose's refill"));
    expect(result).toMatchObject({ ok: true, templateReason: "no_claude", steps: [{ tool: "propose_refill", outcome: "ok" }], proposal: { kind: "proposal" } });
  });

  it("routes a suggestion in the listener's own language", async () => {
    const circle = await visitorWithCircle(db);
    const result = await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, down()), { question: "Qui doit quoi à qui ce mois-ci ?", locale: "fr" });
    expect(result).toMatchObject({ ok: true, templateReason: "no_claude", steps: [{ tool: "get_fairness", outcome: "ok" }] });
  });

  it("still keeps a caregiver to their own seat", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const result = await runAskKin(context(await snapshot(circle, amara), amara, down()), ask("How much is in the pool?"));
    expect(result).toMatchObject({ ok: true, templateReason: "no_claude", answer: "Kin could not answer that from the record. Try one of the suggestions.", steps: [{ tool: "get_pool", outcome: "refused" }] });
  });

  it("is unavailable for a question Kin's own routing does not recognise", async () => {
    const circle = await visitorWithCircle(db);
    expect(await runAskKin(context(await snapshot(circle, circle.userId), circle.userId, down()), ask("Tell me a story"))).toEqual({ ok: false, reason: "unavailable" });
  });
});
