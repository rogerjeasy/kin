import { describe, expect, it } from "vitest";

import { answerPassesGuard, evidenceOf } from "./answer-guard.ts";

/** What the fairness, payout and proposal tools hand back, in the shapes the web app's tools use. */
const FAIRNESS = {
  month: "November 2026",
  members: [
    { member: "Elena", share: "40%", gave: "$700.00", fairShare: "$600.00" },
    { member: "Marcus", share: "35%", gave: "$487.50", fairShare: "$525.00" },
  ],
  owesThePool: [{ member: "Marcus", amount: "$37.50" }],
  thePoolOwes: [{ member: "Elena", amount: "$100.00" }],
};
const PAYOUTS = { paid: [{ to: "Amara", amount: "$264.00", day: "Oct 6", state: "paid", simulated: true }] };
const POOL = { pool: "$1,412.60", month: "November 2026" };
const PROPOSALS = { count: 1, waiting: [{ to: "Ridgeway Stairlifts", amount: "$900.00", purpose: "Repair 999 now", waitingFor: ["Elena", "Marcus"] }] };

const evidence = evidenceOf([FAIRNESS, PAYOUTS, POOL, PROPOSALS]);
const passes = (text: string) => answerPassesGuard(text, evidence, "English");

describe("the answer's number guard", () => {
  it("accepts figures from the tools, sentence by sentence", () => {
    expect(passes("The pool holds $1,412.60. Marcus owes the pool $37.50, and the pool owes Elena $100.00.")).toBe(true);
    expect(passes(`${"Elena is owed $100.00. ".repeat(20)}`)).toBe(true);
  });

  it("refuses a changed digit, a new amount, a link or an empty answer", () => {
    expect(passes("The pool holds $1,412.50.")).toBe(false);
    expect(passes("Elena owes $41.")).toBe(false);
    expect(passes("See https://kin.example for $37.50.")).toBe(false);
    expect(passes("  ")).toBe(false);
  });

  it("refuses an amount the tools returned for someone else, said of a person by name", () => {
    expect(passes("Amara was paid $264.00 on Oct 6.")).toBe(true);
    expect(passes("Elena was paid $264.00 on Oct 6.")).toBe(false);
    expect(passes("Marcus owes the pool $100.00.")).toBe(false);
    // Names in different sentences are read on their own.
    expect(passes("Amara was paid $264.00. Elena is owed $100.00.")).toBe(true);
  });

  it("lets a figure no name was returned beside sit beside any name", () => {
    expect(passes("Elena can see that the pool holds $1,412.60 for November 2026.")).toBe(true);
  });

  it("counts the people still to say yes as belonging to a proposal's figures", () => {
    expect(passes("Elena and Marcus still have to say yes to $900.00 for Ridgeway Stairlifts.")).toBe(true);
  });

  it("never takes a digit inside a purpose or a name as a figure", () => {
    expect(passes("The stairlift repair costs $999.")).toBe(false);
    expect(passes("The pool holds 999 dollars.")).toBe(false);
    // The text itself may be repeated whole, exactly as the record holds it.
    expect(passes("Ridgeway Stairlifts asks $900.00 for Repair 999 now.")).toBe(true);
  });

  it("refuses a digit from a payee's name used as an amount, and keeps a number word inside a name", () => {
    const names = evidenceOf([{ paid: [{ to: "Unit 12 Care", amount: "$80.00" }, { to: "Seven Oaks Pharmacy", amount: "$64.00" }] }]);
    expect(answerPassesGuard("Unit 12 Care was paid $80.00.", names, "English")).toBe(true);
    expect(answerPassesGuard("Unit 12 Care was paid $12.", names, "English")).toBe(false);
    expect(answerPassesGuard("Seven Oaks Pharmacy was paid $64.00.", names, "English")).toBe(true);
    expect(answerPassesGuard("It costs 7 dollars.", names, "English")).toBe(false);
  });

  it("keeps a link inside a repeated name out of the answer", () => {
    const linked = evidenceOf([{ paid: [{ to: "Pay at www.example.com", amount: "$5.00" }] }]);
    expect(answerPassesGuard("Pay at www.example.com was paid $5.00.", linked, "English")).toBe(false);
  });

  it("reads a plain list of texts as figures, as the shift assistant hands it", () => {
    expect(answerPassesGuard("The shift pays $80.00.", ['{"pay":"$80.00"}'], "English")).toBe(true);
    expect(answerPassesGuard("The shift pays $90.00.", ['{"pay":"$80.00"}'], "English")).toBe(false);
  });
});

describe("the evidence the guard reads", () => {
  it("keeps free texts apart from figures, and ties each row's figures to its names", () => {
    expect(evidence.texts).toEqual(expect.arrayContaining(["Elena", "Amara", "Repair 999 now", "Ridgeway Stairlifts"]));
    expect(evidence.figures).not.toContain("Repair 999 now");
    expect([...(evidence.byName.get("amara") ?? [])]).toEqual(expect.arrayContaining(["264", "6"]));
    expect(evidence.byName.get("elena")?.has("264")).toBe(false);
    expect(evidence.unnamed.has("1412.6")).toBe(true);
  });
});
