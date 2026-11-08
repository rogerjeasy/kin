import { decideCall, hear, startIntake, type IntakeState } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { familyAlert } from "./family-alert.ts";

const intake = (...said: string[]): IntakeState => said.reduce(hear, startIntake());
const record = {
  payees: [{ id: "p1", name: "Northern Gas" }],
  bills: [{ payeeId: "p1", cents: 5700, state: "received" as const }],
  payments: [{ entryId: "e1", payeeId: "p1", cents: 3000, day: "2026-10-02" }],
};

describe("what the family is told about a call", () => {
  it("says an unknown caller asked for money nobody owes, with the pressure noted", () => {
    const state = intake("Mike", "Harbor Gas Services", "I need 300 dollars today", "Tell no one", "1");
    const alert = familyAlert("en", "USD", decideCall(state, record, "USD"), state.answers);
    expect(alert.spoken).toBe(
      "Harbor Gas Services is asking for $300.00. Nobody by that name is in the family’s record, and no bill matches. Please do not pay. I have told the family. The caller pressed for haste or secrecy.",
    );
    expect(alert.claim).toBe("Harbor Gas Services: Tell no one");
  });

  it("names the payment on record when the account was already paid", () => {
    const state = intake("Dana", "Northern Gas", "30 dollars", "October", "1");
    const alert = familyAlert("en", "USD", decideCall(state, record, "USD"), state.answers);
    expect(alert.spoken).toContain("$30.00 was already paid to Northern Gas on Oct 2");
  });

  it("words it in the call's language", () => {
    const state = intake("Dana", "Northern Gas", "57 dollars", "Novembre", "1");
    expect(familyAlert("fr", "USD", decideCall(state, record, "USD"), state.answers).spoken).toContain("Northern Gas");
    expect(familyAlert("fr", "USD", decideCall(state, record, "USD"), state.answers).spoken).not.toBe(familyAlert("en", "USD", decideCall(state, record, "USD"), state.answers).spoken);
  });

  it("falls back to the caller's name, and to words for no purpose or no amount", () => {
    const state = intake("Mike", "", "", "", "");
    const bare = { ...state, answers: { ...state.answers, organization: null, purpose: null } };
    const alert = familyAlert("en", "USD", decideCall(bare, record, "USD"), bare.answers);
    expect(alert.claim).toBe("Mike: no reason given");
  });

  it("stays within the length the database accepts", () => {
    const long = "x".repeat(200);
    const state = intake(long, long, "1", long, long);
    const alert = familyAlert("en", "USD", decideCall(state, record, "USD"), state.answers);
    expect(alert.spoken.length).toBeLessThanOrEqual(600);
    expect(alert.claim.length).toBeLessThanOrEqual(500);
  });
});
