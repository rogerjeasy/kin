import { CIRCLE_ROLES, type CircleRole } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { AccessDenied, CIRCLE_ACTIONS, allowedActions, authorize, requireAccess, type CircleAction } from "./circle-access.ts";

const active = (role: CircleRole) => ({ role, status: "active" as const });

describe("what a member may do in a circle", () => {
  // Least-privileged roles first (AGENTS.md section 6).
  it("lets an observer see everything and change nothing", () => {
    expect(allowedActions(active("observer"))).toEqual(["circle.view", "money.view", "own_payments.view", "safety.view", "shift.view"]);
  });

  it("lets a caregiver see only their own payments, and pull the pause switch", () => {
    expect(allowedActions(active("caregiver"))).toEqual(["circle.view", "own_payments.view", "shift.view", "shift.check", "shift.link", "shift.cancel", "circle.pause", "caregiver_bill.submit", "caregiver_receiver.set", "payout_target.set"]);
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

  it("lets only the members who share the cost add money to the pool", () => {
    for (const role of ["observer", "caregiver", "parent"] as const) {
      expect(authorize(active(role), "money.contribute")).toEqual({ allowed: false, reason: "role" });
    }
    for (const role of ["contributor", "organizer"] as const) {
      expect(authorize(active(role), "money.contribute")).toEqual({ allowed: true });
    }
  });

  it("lets only an organizer ask a member for money by PayPal invoice, least privileged first", () => {
    for (const role of ["observer", "caregiver", "parent", "contributor"] as const) {
      expect(authorize(active(role), "invoice.request")).toEqual({ allowed: false, reason: "role" });
    }
    expect(authorize(active("organizer"), "invoice.request")).toEqual({ allowed: true });
    expect(authorize({ role: "organizer", status: "left" }, "invoice.request")).toEqual({ allowed: false, reason: "not_a_member" });
  });

  it("lets only caregivers bill for their own work, only organizers set rates, and the cost-sharers review bills", () => {
    for (const role of CIRCLE_ROLES) {
      expect(authorize(active(role), "caregiver_bill.submit").allowed).toBe(role === "caregiver");
      expect(authorize(active(role), "caregiver_rate.manage").allowed).toBe(role === "organizer");
      expect(authorize(active(role), "caregiver_bill.review").allowed).toBe(role === "organizer" || role === "contributor");
      expect(authorize(active(role), "caregiver_receiver.set").allowed).toBe(role === "caregiver");
      // Holding up a letter and checking a demand: the people who see the circle's money and may act on it, never a caregiver or an observer.
      expect(authorize(active(role), "letter.read").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "claim.check").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "office_line.try").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      // Asking "is it really you?": the people who see the money and may act on it; keeping the list of people to ask: the organizer and the parent.
      expect(authorize(active(role), "presence.check").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "presence.manage").allowed).toBe(role === "organizer" || role === "parent");
      expect(authorize(active(role), "audit_head.keep").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
    }
  });

  it("lets an organizer run the circle but not submit a caregiver's own bill", () => {
    expect(allowedActions(active("organizer"))).toEqual(Object.keys(CIRCLE_ACTIONS).filter((action) => action !== "caregiver_bill.submit" && action !== "caregiver_receiver.set" && action !== "payout_target.set"));
  });

  it("lets only the family confirm a visit, only the parent or organizer grant its standing permission, and only the caregiver choose their wallet", () => {
    for (const role of CIRCLE_ROLES) {
      expect(authorize(active(role), "shift.confirm").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "shift.schedule").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "shift_permission.grant").allowed).toBe(role === "organizer" || role === "parent");
      expect(authorize(active(role), "shift_permission.pause").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "shift_rules.manage").allowed).toBe(role === "organizer");
      expect(authorize(active(role), "shift.link").allowed).toBe(role !== "observer");
      expect(authorize(active(role), "shift.door").allowed).toBe(role === "organizer" || role === "parent");
      expect(authorize(active(role), "shift_call.manage").allowed).toBe(role === "organizer" || role === "parent");
      expect(authorize(active(role), "shift_call.stop").allowed).toBe(role === "organizer" || role === "contributor" || role === "parent");
      expect(authorize(active(role), "payout_target.set").allowed).toBe(role === "caregiver");
      expect(authorize(active(role), "shift.view").allowed).toBe(true);
    }
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
