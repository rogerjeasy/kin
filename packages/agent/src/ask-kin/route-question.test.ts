import { describe, expect, it } from "vitest";

import { isAskKinTool } from "./ask-kin-tools.ts";
import { routeQuestion } from "./route-question.ts";

const known = { members: ["Rose", "Elena", "Marcus", "Ana", "Amara"], payees: ["Northfield Gas", "Lakeside Water", "Amara"] };
const route = (question: string) => routeQuestion(question, known);

describe("Kin's own routing of a question, with no model", () => {
  it("routes the four suggested questions to their tools", () => {
    expect(route("Has Amara been paid?")).toEqual([{ name: "get_paypal_payout_status", input: { payee: "Amara" } }]);
    expect(route("Who owes whom this month?")).toEqual([{ name: "get_fairness", input: {} }]);
    expect(route("Is a $300.00 demand from Harbor Gas real?")).toEqual([{ name: "check_claim", input: { payee: "Harbor Gas", amount: "300" } }]);
    expect(route("Reorder Rose's refill")).toEqual([{ name: "propose_refill", input: {} }]);
  });

  it("routes the suggestions in Kin's other languages", () => {
    expect(route("Wurde Amara bezahlt?")).toEqual([{ name: "get_paypal_payout_status", input: { payee: "Amara" } }]);
    expect(route("Qui doit quoi à qui ce mois-ci ?")).toEqual([{ name: "get_fairness", input: {} }]);
    expect(route("¿Es real un cobro de 300,00 US$ de Harbor Gas?")).toEqual([{ name: "check_claim", input: { payee: "Harbor Gas", amount: "300" } }]);
    expect(route("هل مطالبة بمبلغ 300.00 US$ من Harbor Gas حقيقية؟")).toEqual([{ name: "check_claim", input: { payee: "Harbor Gas", amount: "300" } }]);
    expect(route("להזמין שוב את המרשם של רוז")).toEqual([{ name: "propose_refill", input: {} }]);
  });

  it("routes a question that needs two reads to both, in a fixed order", () => {
    expect(route("Has Amara been paid, and can the pool cover her next visit?")).toEqual([
      { name: "get_paypal_payout_status", input: { payee: "Amara" } },
      { name: "get_pool", input: {} },
    ]);
    expect(route("Who owes whom this month, and is anything waiting for my yes?").map((call) => call.name)).toEqual(["get_fairness", "list_proposals"]);
  });

  it("checks a demand against a payee the record knows, and leaves out the payout and fairness reads its words also match", () => {
    expect(route("A caller says Rose owes Northfield Gas $300 — is that real, and was gas paid?")).toEqual([{ name: "check_claim", input: { payee: "Northfield Gas", amount: "300" } }]);
  });

  it("does not route a demand without an amount or a payee, so no amount is ever guessed", () => {
    expect(route("Is this demand real?")).toEqual([]);
    expect(route("Is a demand of $300 real?")).toEqual([]);
  });

  it("proposes nothing for a question that merely names a refill", () => {
    expect(route("What did the refill cost?").map((call) => call.name)).not.toContain("propose_refill");
  });

  it("routes nothing it does not recognise, and only ever names Ask Kin's own tools", () => {
    expect(route("Tell me a story")).toEqual([]);
    const all = route("Bills, the pool, the ledger, top-ups, subscriptions and who owes whom?");
    expect(all.length).toBeLessThanOrEqual(3);
    expect(all.every((call) => isAskKinTool(call.name))).toBe(true);
  });
});
