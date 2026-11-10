import { describe, expect, it } from "vitest";

import type { CircleRole } from "./roles.ts";
import { forAll } from "./testing/property.ts";
import { attestationConflicts, attestationMet, attestationStillNeeded, type Attestation, type AttestationConflicts } from "./wish-trigger.ts";
import { TRIGGER_EVENTS, type InForceWish, type WishRule } from "./wishes.ts";

const says = (memberId: string, role: CircleRole, stance: Attestation["stance"] = "start"): Attestation => ({ memberId, role, stance });
const wish = (rule: WishRule, trigger: InForceWish["trigger"] = "either"): InForceWish => ({ id: `w-${rule.kind}`, wishKey: "k", version: 1, quote: "q", saidOn: "2026-09-12", trigger, rule });

/** Rose's family: Marcus is the successor her wish names, and Amara the caregiver her wish keeps paid. */
const CONFLICTS: AttestationConflicts = { excluded: ["marcus"], interested: ["amara"] };
const ROLES: Readonly<Record<string, CircleRole>> = { elena: "organizer", marcus: "contributor", ana: "contributor", amara: "caregiver", ben: "caregiver", daniel: "observer", rose: "parent" };

describe("who has a stake in a trigger", () => {
  it("is read from her wishes in force for that event", () => {
    const wishes = [wish({ kind: "successor", memberId: "marcus" }), wish({ kind: "keep_paying", payeeId: "payee-amara" }), wish({ kind: "keep_paying", payeeId: "payee-gas" }, "care_home")];
    const memberOf = (payeeId: string) => (payeeId === "payee-amara" ? "amara" : null);
    expect(attestationConflicts(wishes, "hospital", memberOf)).toEqual({ excluded: ["marcus"], interested: ["amara"] });
    expect(attestationConflicts([], "care_home", memberOf)).toEqual({ excluded: [], interested: [] });
  });

  it("never lets the successor's word count toward the trigger that seats them", () => {
    expect(attestationMet("hospital", [says("elena", "organizer"), says("marcus", "contributor")], "start", CONFLICTS)).toBe(false);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("marcus", "contributor"), says("ana", "contributor")], "start", CONFLICTS)).toBe(true);
    // Ending it takes nothing from anyone who says so, so every word counts.
    expect(attestationMet("hospital", [says("elena", "organizer", "end"), says("marcus", "contributor", "end")], "end", CONFLICTS)).toBe(true);
  });

  it("never counts the word of the caregiver her wish keeps paid toward starting it, only toward ending it", () => {
    expect(attestationMet("hospital", [says("elena", "organizer"), says("amara", "caregiver")], "start", CONFLICTS)).toBe(false);
    expect(attestationMet("hospital", [says("elena", "organizer"), says("ben", "caregiver")], "start", CONFLICTS)).toBe(true);
    expect(attestationMet("hospital", [says("elena", "organizer", "end"), says("amara", "caregiver", "end")], "end", CONFLICTS)).toBe(true);
    expect(attestationStillNeeded("hospital", [says("marcus", "contributor"), says("amara", "caregiver")], "start", CONFLICTS)).toBe("anyone");
  });

  it("never reaches the threshold on conflicted words without a word from someone who gains nothing", () => {
    const members = Object.keys(ROLES) as [string, ...string[]];
    forAll(
      (random) => ({
        event: random.pick(TRIGGER_EVENTS),
        conflicts: { excluded: random.shuffle(members).slice(0, random.int(0, 2)), interested: random.shuffle(members).slice(0, random.int(0, 2)) },
        attestations: Array.from({ length: random.int(0, 7) }, () => {
          const memberId = random.pick(members);
          return says(memberId, ROLES[memberId] ?? "observer", random.pick(["start", "end"] as const));
        }),
      }),
      ({ event, conflicts, attestations }) => {
        if (!attestationMet(event, attestations, "start", conflicts)) return;
        const clean = new Set(
          attestations
            .filter((each) => each.stance === "start" && !conflicts.excluded.includes(each.memberId) && !conflicts.interested.includes(each.memberId) && each.role !== "parent" && each.role !== "observer" && (each.role !== "caregiver" || event === "hospital"))
            .map((each) => each.memberId),
        );
        // Two people who gain nothing, always.
        expect(clean.size).toBeGreaterThanOrEqual(2);
        expect(attestationMet(event, attestations.filter((each) => clean.has(each.memberId)), "start", conflicts)).toBe(true);
        // And with no stakes at all, the words are at least as strong.
        expect(attestationMet(event, attestations, "start")).toBe(true);
      },
    );
  });
});
