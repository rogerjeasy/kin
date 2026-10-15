import { CIRCLE_ROLES, type CircleRole } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { AccessDenied, CIRCLE_ACTIONS, allowedActions, authorize, requireAccess, type CircleAction } from "./circle-access.ts";

const active = (role: CircleRole) => ({ role, status: "active" as const });

describe("what a member may do in a circle", () => {
  // Least-privileged roles first (AGENTS.md section 6).
  it("lets an observer see everything and change nothing", () => {
    expect(allowedActions(active("observer"))).toEqual(["circle.view", "money.view", "own_payments.view", "safety.view"]);
  });

  it("lets a caregiver see only their own payments, and pull the pause switch", () => {
    expect(allowedActions(active("caregiver"))).toEqual(["circle.view", "own_payments.view", "circle.pause"]);
    expect(authorize(active("caregiver"), "money.view")).toEqual({ allowed: false, reason: "role" });
    expect(authorize(active("caregiver"), "proposal.answer")).toEqual({ allowed: false, reason: "role" });
  });

  it("lets the parent and contributors answer proposals, but not invite or read the audit log", () => {
    for (const role of ["parent", "contributor"] as const) {
      expect(authorize(active(role), "proposal.answer").allowed).toBe(true);
      expect(authorize(active(role), "member.invite")).toEqual({ allowed: false, reason: "role" });
      expect(authorize(active(role), "audit.view")).toEqual({ allowed: false, reason: "role" });
    }
  });

  it("lets an organizer do everything", () => {
    expect(allowedActions(active("organizer"))).toEqual(Object.keys(CIRCLE_ACTIONS));
  });

  it.each(Object.keys(CIRCLE_ACTIONS) as CircleAction[])("refuses %s to anyone without an active seat", (action) => {
    expect(authorize(null, action)).toEqual({ allowed: false, reason: "not_a_member" });
    for (const role of CIRCLE_ROLES) {
      expect(authorize({ role, status: "invited" }, action)).toEqual({ allowed: false, reason: "not_a_member" });
      expect(authorize({ role, status: "left" }, action)).toEqual({ allowed: false, reason: "not_a_member" });
    }
  });

  it("names only real roles, and gives every role something", () => {
    for (const roles of Object.values(CIRCLE_ACTIONS)) {
      for (const role of roles) expect(CIRCLE_ROLES).toContain(role);
    }
    for (const role of CIRCLE_ROLES) expect(allowedActions(active(role)).length).toBeGreaterThan(0);
  });

  it("throws a typed refusal that says what was refused", () => {
    expect(() => requireAccess(active("observer"), "circle.pause")).toThrow(AccessDenied);
    try {
      requireAccess(null, "money.view");
    } catch (error) {
      expect(error).toMatchObject({ action: "money.view", reason: "not_a_member", retryable: false });
    }
  });
});
