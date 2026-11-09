import { CIRCLE_ROLES, type CircleRole } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { CIRCLE_ACTIONS, authorize, type CircleAction } from "./circle-access.ts";
import {
  DELEGATION_SCOPES,
  DELEGATION_SCOPE_ACTIONS,
  authorizeDelegated,
  bearerToken,
  delegationTokenHint,
  hashDelegationToken,
  isDelegationScope,
  newDelegationToken,
} from "./delegation.ts";

const active = (role: CircleRole) => ({ role, status: "active" as const });
const ACTIONS = Object.keys(CIRCLE_ACTIONS) as CircleAction[];

/** Every action that answers, pays, signs, grants or redirects money. No assistant may take one. */
const NEVER_DELEGATED: readonly CircleAction[] = [
  "proposal.answer",
  "money.contribute",
  "mandate.grant",
  "mandate.pause",
  "shift.confirm",
  "shift.check",
  "shift_permission.grant",
  "care_agreement.sign",
  "care_agreement.propose",
  "receipt.decide",
  "caregiver_bill.review",
  "settlement.propose",
  "invoice.request",
  "payout_target.set",
  "caregiver_receiver.set",
  "settlement_receiver.set",
  "agreement.accept",
  "agreement.propose",
  "member.invite",
  "presence.manage",
  "circle.pause",
];

describe("what a member's assistant may do under a delegation", () => {
  it("never widens a role: every delegated yes is a yes the member's own role gives", () => {
    // Every role, every scope, every action: small enough to ask them all.
    for (const role of CIRCLE_ROLES) {
      for (const scope of DELEGATION_SCOPES) {
        for (const action of ACTIONS) {
          if (authorizeDelegated(active(role), scope, action).allowed) expect({ role, scope, action, own: authorize(active(role), action).allowed }).toEqual({ role, scope, action, own: true });
        }
      }
    }
  });

  it("lists no action that answers a proposal, pays, signs or changes where money goes, in any scope", () => {
    for (const scope of DELEGATION_SCOPES) {
      for (const action of NEVER_DELEGATED) expect({ scope, action, listed: DELEGATION_SCOPE_ACTIONS[scope].includes(action) }).toEqual({ scope, action, listed: false });
    }
    for (const role of CIRCLE_ROLES) {
      for (const scope of DELEGATION_SCOPES) expect(authorizeDelegated(active(role), scope, "proposal.answer").allowed).toBe(false);
    }
  });

  it("refuses an observer's and a caregiver's assistant everything their seat refuses, before the scope is asked", () => {
    expect(authorizeDelegated(active("observer"), "propose", "refill.propose")).toEqual({ allowed: false, reason: "role" });
    expect(authorizeDelegated(active("caregiver"), "read", "money.view")).toEqual({ allowed: false, reason: "role" });
    expect(authorizeDelegated(active("caregiver"), "read", "own_payments.view")).toEqual({ allowed: true });
    expect(authorizeDelegated({ role: "organizer", status: "left" }, "read", "circle.view")).toEqual({ allowed: false, reason: "not_a_member" });
    expect(authorizeDelegated(null, "read", "circle.view")).toEqual({ allowed: false, reason: "not_a_member" });
  });

  it("lets a read scope only read, and a propose scope also raise a refill proposal", () => {
    expect(authorizeDelegated(active("contributor"), "read", "money.view")).toEqual({ allowed: true });
    expect(authorizeDelegated(active("contributor"), "read", "refill.propose")).toEqual({ allowed: false, reason: "scope" });
    expect(authorizeDelegated(active("contributor"), "propose", "refill.propose")).toEqual({ allowed: true });
    expect(DELEGATION_SCOPE_ACTIONS.propose).toEqual(expect.arrayContaining([...DELEGATION_SCOPE_ACTIONS.read]));
  });

  it("lets every seat but an observer connect an assistant, and only the organizer manage an agency's key", () => {
    for (const role of CIRCLE_ROLES) {
      expect(authorize(active(role), "delegation.grant").allowed).toBe(role !== "observer");
      expect(authorize(active(role), "agency_key.manage").allowed).toBe(role === "organizer");
    }
  });

  it("knows its scopes by name and nothing else", () => {
    expect(isDelegationScope("read")).toBe(true);
    expect(isDelegationScope("propose")).toBe(true);
    for (const other of ["approve", "admin", "READ", "", null, 1]) expect(isDelegationScope(other)).toBe(false);
  });
});

describe("a delegation token", () => {
  it("is long, random and recognisable, and only its SHA-256 is kept", () => {
    const token = newDelegationToken();
    expect(token).toMatch(/^kin_dlg_[A-Za-z0-9_-]{43}$/u);
    expect(newDelegationToken()).not.toBe(token);
    expect(hashDelegationToken(token)).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashDelegationToken(token)).toBe(hashDelegationToken(token));
    expect(delegationTokenHint(token)).toBe(token.slice(-4));
  });

  it("is read from a bearer header only, in Kin's own shape", () => {
    const token = newDelegationToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBe(token);
    for (const header of [null, "", token, `Basic ${token}`, `Bearer ${token}x`, "Bearer kin_dlg_short", `Bearer ${token} extra`]) expect(bearerToken(header)).toBeNull();
  });
});
