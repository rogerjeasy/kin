import { describe, expect, it } from "vitest";

import { CIRCLE_ROLES, type CircleRole } from "./roles.ts";
import { forAll } from "./testing/property.ts";
import { WISH_TRIGGER_STATES, attestationMet, attestationStillNeeded, mayAttest, wishTriggerMoveAllowed, type Attestation } from "./wish-trigger.ts";
import { TRIGGER_EVENTS } from "./wishes.ts";

const says = (memberId: string, role: CircleRole, stance: Attestation["stance"] = "start"): Attestation => ({ memberId, role, stance });

describe("a trigger is attested by people", () => {
  it("takes two family members, or one and the caregiver for a hospital admission", () => {
    expect(attestationMet("hospital", [says("elena", "organizer")], "start")).toBe(false);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("marcus", "contributor")], "start")).toBe(true);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("amara", "caregiver")], "start")).toBe(true);
    expect(attestationMet("care_home", [says("elena", "organizer"), says("amara", "caregiver")], "start")).toBe(false);
    expect(attestationMet("hospital", [says("amara", "caregiver"), says("ben", "caregiver")], "start")).toBe(false);
  });

  it("never counts the parent, an observer, the same person twice, or the other stance", () => {
    expect(attestationMet("hospital", [says("elena", "organizer"), says("rose", "parent")], "start")).toBe(false);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("daniel", "observer")], "start")).toBe(false);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("elena", "organizer")], "start")).toBe(false);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("marcus", "contributor", "end")], "start")).toBe(false);
    expect(mayAttest("parent", "hospital")).toBe(false);
    expect(mayAttest("caregiver", "care_home")).toBe(false);
  });

  it("says who is still needed", () => {
    expect(attestationStillNeeded("hospital", [], "start")).toBe("anyone");
    expect(attestationStillNeeded("hospital", [says("amara", "caregiver")], "start")).toBe("family");
    expect(attestationStillNeeded("hospital", [says("elena", "organizer")], "start")).toBe("anyone");
    expect(attestationStillNeeded("hospital", [says("elena", "organizer"), says("marcus", "contributor")], "start")).toBe("none");
  });

  it("is never met by fewer than two different people who may attest, one of them family", () => {
    forAll(
      (random) => ({
        event: random.pick(TRIGGER_EVENTS),
        stance: random.pick(["start", "end"] as const),
        attestations: Array.from({ length: random.int(0, 6) }, () => says(random.pick(["a", "b", "c", "d"] as const), random.pick(CIRCLE_ROLES), random.pick(["start", "end"] as const))),
      }),
      ({ event, stance, attestations }) => {
        // A member holds one role in a circle: keep the first role each one attested in.
        const seat = new Map<string, CircleRole>();
        const consistent = attestations.map((each) => {
          const role = seat.get(each.memberId) ?? each.role;
          seat.set(each.memberId, role);
          return { ...each, role };
        });
        const counted = consistent.filter((each) => each.stance === stance && mayAttest(each.role, event));
        const people = new Set(counted.map((each) => each.memberId));
        const family = counted.some((each) => each.role === "organizer" || each.role === "contributor");
        expect(attestationMet(event, consistent, stance)).toBe(people.size >= 2 && family);
      },
    );
  });

  it("moves only forward: reported, then active or dismissed, then ended", () => {
    expect(wishTriggerMoveAllowed("reported", "active")).toBe(true);
    expect(wishTriggerMoveAllowed("active", "ended")).toBe(true);
    expect(wishTriggerMoveAllowed("active", "reported")).toBe(false);
    expect(wishTriggerMoveAllowed("reported", "ended")).toBe(false);
    for (const to of WISH_TRIGGER_STATES) {
      expect(wishTriggerMoveAllowed("ended", to)).toBe(false);
      expect(wishTriggerMoveAllowed("dismissed", to)).toBe(false);
    }
  });
});
