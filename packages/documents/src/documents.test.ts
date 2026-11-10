import type { RawReading } from "@kin/agent";
import { describe, expect, it } from "vitest";

import { amountsIn } from "./amounts.ts";
import { fieldEvidence, needsAction, parseStoredReading, readLetterText, readableName, settleReading } from "./index.ts";

const context = { currency: "USD", today: "2026-11-07" };
const letter = "Greenway Power\nAccount 4471\nAmount due: $86.40\nPlease pay by 2026-11-20.";
const raw: RawReading = { kind: "bill", sender: "Greenway Power", amount: "86.40", dueOn: "2026-11-20", demandsPayment: true, pressure: false, quote: null };

describe("amounts in a document's words", () => {
  it("reads decimals however they are written, as whole cents", () => {
    expect(amountsIn("pay 84, 84.50, 1,284.00, 1.284,00 or 84,5", "USD")).toEqual([8_400, 8_450, 128_400, 128_400, 8_450]);
  });

  it("ignores zero, and anything above a household bill", () => {
    expect(amountsIn("0.00 and 99999999", "USD")).toEqual([]);
  });
});

describe("checking what the model says a document holds", () => {
  it("keeps an amount and a sender that the document's own words contain", () => {
    expect(settleReading(raw, { ...context, text: letter })).toMatchObject({ kind: "bill", sender: "Greenway Power", amountCents: 8_640, dueOn: "2026-11-20", confidence: 0.9, source: "model_text" });
  });

  it("drops a sender or an amount the words do not contain, instead of repairing it", () => {
    const reading = settleReading({ ...raw, sender: "Revenue Dept", amount: "860.40" }, { ...context, text: letter });
    expect(reading).toMatchObject({ sender: null, amountCents: null, kind: "letter", confidence: 0.6 });
  });

  it("drops an amount that is not a plain decimal, or is not positive", () => {
    for (const amount of ["86,40", "$86.40", "-5", "0", "86.405", "eighty", ""]) {
      expect(settleReading({ ...raw, amount }, { ...context, text: null }).amountCents).toBeNull();
    }
  });

  it("cannot check a photograph's words, so it keeps an amount only from the words the model says it read, with a lower confidence", () => {
    expect(settleReading({ ...raw, quote: "Amount due: $86.40" }, { ...context, text: null })).toMatchObject({ amountCents: 8_640, confidence: 0.7, source: "model_photo" });
  });

  it("drops a photograph's amount the model cannot point to, so a person fills it in", () => {
    for (const quote of [null, "Greenway Power, account 4471", "Amount due: $68.40"]) {
      expect(settleReading({ ...raw, quote }, { ...context, text: null }), String(quote)).toMatchObject({ amountCents: null, kind: "letter", source: "model_photo" });
    }
  });

  it("drops an impossible or implausible due date", () => {
    for (const dueOn of ["2026-02-30", "20-11-2026", "2031-01-01", "2020-01-01"]) {
      expect(settleReading({ ...raw, dueOn }, { ...context, text: null }).dueOn).toBeNull();
    }
  });

  it("drops a sender that is empty or too long", () => {
    expect(settleReading({ ...raw, sender: "  " }, { ...context, text: null }).sender).toBeNull();
    expect(settleReading({ ...raw, sender: "x".repeat(81) }, { ...context, text: null }).sender).toBeNull();
  });
});

describe("reading typed words with plain rules", () => {
  it("finds the labelled amount, the sender and an unambiguous date, with the lowest confidence", () => {
    expect(readLetterText(letter, context)).toMatchObject({ kind: "bill", sender: "Greenway Power", amountCents: 8_640, dueOn: "2026-11-20", demandsPayment: true, pressure: false, confidence: 0.5, source: "rules" });
  });

  it("reads a named-month date and a labelled sender", () => {
    expect(readLetterText("From: Hillside Pharmacy\nStatement\nTotal due 42.10\nDue November 25, 2026", context)).toMatchObject({ sender: "Hillside Pharmacy", amountCents: 4_210, dueOn: "2026-11-25" });
  });

  it("flags pressure, such as gift cards, and still reads the amount", () => {
    const scam = readLetterText("Revenue Recovery\nFinal notice. Pay 1,200.00 today by gift card or face arrest.", context);
    expect(scam).toMatchObject({ pressure: true, amountCents: 120_000 });
    expect(needsAction(scam)).toBe(false);
  });

  it("reads a receipt, and a letter with no amount, as nothing to pay", () => {
    expect(readLetterText("Hillside Pharmacy\nReceipt: paid in full 42.10", context).kind).toBe("receipt");
    expect(readLetterText("Dear Rose, we have moved our office.", context)).toMatchObject({ kind: "letter", amountCents: null, demandsPayment: false });
  });

  it("does not guess among several unlabelled amounts", () => {
    expect(readLetterText("Greenway Power\nwe charged 10.00 and 20.00", context).amountCents).toBeNull();
  });
});

describe("which readings need a person to act", () => {
  it("is a bill, from a sender Kin can name, for an amount, without pressure", () => {
    const base = { kind: "bill", sender: "Greenway Power", amountCents: 8_640, pressure: false };
    expect(needsAction(base)).toBe(true);
    for (const change of [{ kind: "receipt" }, { sender: null }, { amountCents: null }, { pressure: true }]) expect(needsAction({ ...base, ...change })).toBe(false);
  });
});

describe("a reading stored with a document", () => {
  it("comes back as it was stored", () => {
    const stored = { kind: "bill", sender: "Greenway Power", amountCents: 8_640, dueOn: "2026-11-20", demandsPayment: true, pressure: false, confidence: 0.9, source: "model_text" };
    expect(parseStoredReading(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("is refused when it does not look like a reading", () => {
    for (const bad of [null, "x", [], {}, { kind: "bill" }, { kind: "bill", sender: null, amountCents: -1, dueOn: null, demandsPayment: true, pressure: false, confidence: 0.5, source: "rules" }, { kind: "bill", sender: null, amountCents: null, dueOn: null, demandsPayment: true, pressure: false, confidence: 2, source: "rules" }]) {
      expect(parseStoredReading(bad)).toBeNull();
    }
  });
});

describe("a name printed in capitals", () => {
  const printed = "CITY OF SPRINGFIELD WATER DEPARTMENT\nAccount 4471\nAmount due: $61.00\nPlease pay by 2026-11-20.";

  it("is shown in a readable case, keeping acronyms and small words sensible", () => {
    expect(readableName("CITY OF SPRINGFIELD WATER DEPARTMENT")).toBe("City of Springfield Water Department");
    expect(readableName("ACME PLUMBING LLC")).toBe("Acme Plumbing LLC");
    expect(readableName("PG&E")).toBe("PG&E");
    expect(readableName("O'BRIEN & SONS INC.")).toBe("O'Brien & Sons Inc.");
    expect(readableName("THE ELM STREET PHARMACY")).toBe("The Elm Street Pharmacy");
  });

  it("is left alone when it already has lower-case letters or has no case at all", () => {
    expect(readableName("Greenway Power Co")).toBe("Greenway Power Co");
    expect(readableName("iPhone Repairs LLC")).toBe("iPhone Repairs LLC");
    expect(readableName("شركة الكهرباء")).toBe("شركة الكهرباء");
  });

  it("is readable in the settled reading while the quoted evidence stays the letter's own capitals", () => {
    const reading = settleReading({ ...raw, sender: "CITY OF SPRINGFIELD WATER DEPARTMENT", amount: "61.00" }, { ...context, text: printed });
    expect(reading.sender).toBe("City of Springfield Water Department");
    expect(reading.amountCents).toBe(6_100);
    expect(fieldEvidence(printed, reading, "USD")).toContainEqual({ field: "sender", quote: "CITY OF SPRINGFIELD WATER DEPARTMENT" });
  });

  it("is readable when plain rules read the sender line too", () => {
    expect(readLetterText(printed, { currency: "USD" }).sender).toBe("City of Springfield Water Department");
  });
});
