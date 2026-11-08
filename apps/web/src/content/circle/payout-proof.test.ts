import type { ExecutionRecord } from "@kin/db";
import { describe, expect, it } from "vitest";

import { getDictionary } from "@/i18n/dictionary";
import { locales } from "@/i18n/locales";

import { demoPayee, demoPayeeNote, payoutProofs } from "./payout-proof";

const execution = (change: Partial<ExecutionRecord>): ExecutionRecord => ({
  id: "e1",
  proposalId: "p1",
  state: "confirmed",
  paypalBatchId: null,
  paypalItemId: null,
  submittedAt: null,
  confirmedAt: null,
  ...change,
});

describe("a payout's PayPal proof", () => {
  it("is PayPal's batch and item for a payout PayPal's sandbox made", () => {
    const { byProposal, byItem } = payoutProofs([execution({ paypalBatchId: "5UXD2E8A7EBQJ", paypalItemId: "8AELMXH8UB2P8" })]);
    const proof = { proposalId: "p1", batchId: "5UXD2E8A7EBQJ", itemId: "8AELMXH8UB2P8", state: "confirmed" };
    expect(byProposal.get("p1")).toEqual(proof);
    expect(byItem.get("8AELMXH8UB2P8")).toEqual(proof);
  });

  it("shows a payout still at PayPal by its batch, before the item is read back", () => {
    const { byProposal, byItem } = payoutProofs([execution({ state: "pending_at_paypal", paypalBatchId: "5UXD2E8A7EBQJ" })]);
    expect(byProposal.get("p1")).toMatchObject({ batchId: "5UXD2E8A7EBQJ", itemId: null, state: "pending_at_paypal" });
    expect(byItem.size).toBe(0);
  });

  it("is never claimed for a simulated payout, even one whose sandbox batch failed first", () => {
    const { byProposal, byItem } = payoutProofs([
      execution({ paypalItemId: "simulated-payout-e1" }),
      execution({ id: "e2", proposalId: "p2", paypalBatchId: "FAILEDBATCH01", paypalItemId: "simulated-payout-e2" }),
      execution({ id: "e3", proposalId: "p3", state: "created" }),
    ]);
    expect(byProposal.size).toBe(0);
    expect(byItem.size).toBe(0);
  });
});

describe("what a demo circle says about a caregiver's address", () => {
  it("names Kin's sandbox account when demo payouts go to the sandbox, simulated money otherwise, and nothing in a real circle", () => {
    expect(demoPayee(true, true)).toBe("sandbox");
    expect(demoPayee(true, false)).toBe("simulated");
    expect(demoPayee(false, true)).toBeNull();
    const copy = { receiverSandbox: "sandbox", receiverSimulated: "simulated" };
    expect(demoPayeeNote(copy, "sandbox")).toBe("sandbox");
    expect(demoPayeeNote(copy, "simulated")).toBe("simulated");
    expect(demoPayeeNote(copy, null)).toBeNull();
  });

  it.each(locales)("in %s, has every sandbox payout word, each naming the caregiver where it should", async (locale) => {
    const english = (await getDictionary("en")).sandboxPayout;
    const words = (await getDictionary(locale)).sandboxPayout;
    expect(Object.keys(words).toSorted()).toEqual(Object.keys(english).toSorted());
    expect(Object.keys(words.states).toSorted()).toEqual(Object.keys(english.states).toSorted());
    expect(words.receiverSandbox).toContain("{name}");
    expect(words.receiverSimulated).toContain("{name}");
    // Test money is never presented as simulated, nor as real money.
    expect(words.tag).toContain("PayPal");
  });
});
