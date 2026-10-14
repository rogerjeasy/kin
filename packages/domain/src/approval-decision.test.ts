import { describe, expect, it } from "vitest";

import {
  decideApprovals,
  type ApprovalVote,
  type PendingPlan,
} from "./approval-decision.ts";
import { planApprovals, type ApprovalRequest } from "./approval-plan.ts";
import { ApprovalError } from "./approval-error.ts";
import { pauseEndsAt } from "./pause.ts";
import {
  NOW,
  TERMS,
  approvalRequest,
  randomApprovalRequest,
  randomMembers,
  randomVotes,
  vote,
} from "./testing/approvals.ts";
import { forAll } from "./testing/property.ts";

function pendingPlan(overrides: Partial<ApprovalRequest> = {}): PendingPlan {
  const plan = planApprovals(approvalRequest(overrides));
  if (plan.outcome !== "needs_approval") {
    throw new Error(`Expected a plan that needs approval, got ${plan.outcome}`);
  }
  return plan;
}

const decide = (
  plan: PendingPlan,
  votes: readonly ApprovalVote[],
  at: { now?: Date; pausedUntil?: Date | null } = {},
) =>
  decideApprovals({
    plan,
    votes,
    pausedUntil: at.pausedUntil ?? null,
    now: at.now ?? NOW,
  });

const payTo = (memberId: string, role: ApprovalVote["role"]) => ({
  status: "approved" as const,
  member: { memberId, role },
  autoPay: null,
});

describe("decideApprovals", () => {
  const ordinary = pendingPlan();
  const large = pendingPlan({ cents: TERMS.secondApprovalAboveCents + 1 });
  const parentDecides = pendingPlan({ kind: "purchase", cents: 9200, parentLevel: "decides" });

  it("waits until someone answers", () => {
    expect(decide(ordinary, [])).toBe("pending");
  });

  it("approves with an organizer's yes", () => {
    expect(decide(ordinary, [vote("elena", "organizer")])).toBe("approved");
  });

  it("does not let a contributor fill an organizer's place", () => {
    expect(decide(ordinary, [vote("marcus", "contributor")])).toBe("pending");
  });

  it("ignores caregivers and observers, whatever they answer", () => {
    const outsiders = [
      vote("amara", "caregiver"),
      vote("lawyer", "observer"),
      vote("amara", "caregiver", "reject"),
      vote("lawyer", "observer", "reject"),
    ];
    expect(decide(ordinary, outsiders)).toBe("pending");
    expect(decide(ordinary, [...outsiders, vote("elena", "organizer")])).toBe("approved");
  });

  it("rejects on a no from anyone whose yes would count, even after a yes", () => {
    expect(decide(ordinary, [vote("elena", "organizer", "reject")])).toBe("rejected");
    expect(
      decide(ordinary, [vote("elena", "organizer"), vote("bob", "organizer", "reject")]),
    ).toBe("rejected");
  });

  describe("above the large-payment threshold", () => {
    it("needs two different members", () => {
      expect(decide(large, [vote("elena", "organizer")])).toBe("pending");
      expect(decide(large, [vote("elena", "organizer"), vote("elena", "organizer")])).toBe(
        "pending",
      );
      expect(decide(large, [vote("elena", "organizer"), vote("marcus", "contributor")])).toBe(
        "approved",
      );
    });

    it("still needs the organizer", () => {
      expect(
        decide(large, [vote("marcus", "contributor"), vote("ana", "contributor")]),
      ).toBe("pending");
    });

    it("accepts two organizers, whichever answered first", () => {
      expect(decide(large, [vote("elena", "organizer"), vote("bob", "organizer")])).toBe(
        "approved",
      );
      expect(decide(large, [vote("bob", "organizer"), vote("elena", "organizer")])).toBe(
        "approved",
      );
    });

    it("lets a contributor's no stop it", () => {
      expect(
        decide(large, [vote("elena", "organizer"), vote("marcus", "contributor", "reject")]),
      ).toBe("rejected");
    });
  });

  describe("when the parent decides", () => {
    it("needs the parent's yes, not the organizer's", () => {
      expect(decide(parentDecides, [vote("elena", "organizer")])).toBe("pending");
      expect(decide(parentDecides, [vote("rose", "parent")])).toBe("approved");
    });

    it("stops on the parent's no", () => {
      expect(decide(parentDecides, [vote("rose", "parent", "reject")])).toBe("rejected");
    });

    it("pairs the parent with a sibling above the large-payment threshold", () => {
      const both = pendingPlan({ cents: 60000, parentLevel: "decides" });
      expect(decide(both, [vote("rose", "parent")])).toBe("pending");
      expect(decide(both, [vote("rose", "parent"), vote("ana", "contributor")])).toBe(
        "approved",
      );
    });
  });

  it("does not count an informed parent's answer", () => {
    expect(
      decide(ordinary, [vote("rose", "parent", "reject"), vote("elena", "organizer")]),
    ).toBe("approved");
  });

  describe("a payment to a member", () => {
    const toElena = pendingPlan({ kind: "member_payout", cents: 12600, payee: payTo("elena", "organizer") });
    const toMarcus = pendingPlan({ kind: "member_payout", cents: 7600, payee: payTo("marcus", "contributor") });

    it("is never approved by the payee alone", () => {
      expect(decide(toElena, [vote("elena", "organizer")])).toBe("pending");
    });

    it("is approved when another member also says yes", () => {
      expect(decide(toElena, [vote("elena", "organizer"), vote("ana", "contributor")])).toBe(
        "approved",
      );
    });

    it("stops when another member says no", () => {
      expect(
        decide(toElena, [vote("elena", "organizer"), vote("ana", "contributor", "reject")]),
      ).toBe("rejected");
    });

    it("still needs its organizer's place filled", () => {
      expect(decide(toElena, [vote("ana", "contributor")])).toBe("pending");
      expect(decide(toMarcus, [vote("marcus", "contributor")])).toBe("pending");
    });

    it("needs no extra yes when an organizer approves someone else's payout", () => {
      expect(decide(toMarcus, [vote("elena", "organizer")])).toBe("approved");
    });

    it("pays a caregiver on the organizer's yes", () => {
      const toAmara = pendingPlan({ kind: "caregiver_payout", cents: 26400, payee: payTo("amara", "caregiver") });
      expect(decide(toAmara, [vote("amara", "caregiver"), vote("elena", "organizer")])).toBe(
        "approved",
      );
    });
  });

  it("refuses answers that give one member two roles", () => {
    expect(() =>
      decide(ordinary, [vote("elena", "contributor"), vote("elena", "organizer")]),
    ).toThrow(ApprovalError);
  });

  describe("time", () => {
    it("expires at its deadline, not before", () => {
      const yes = [vote("elena", "organizer")];
      const justBefore = new Date(ordinary.expiresAt.getTime() - 1);
      expect(decide(ordinary, yes, { now: justBefore })).toBe("approved");
      expect(decide(ordinary, yes, { now: ordinary.expiresAt })).toBe("expired");
    });

    it("takes no approval while the circle is paused", () => {
      expect(
        decide(ordinary, [vote("elena", "organizer")], { pausedUntil: pauseEndsAt(NOW) }),
      ).toBe("paused");
    });

    it("counts the approvals again once the pause lifts", () => {
      const until = pauseEndsAt(NOW);
      expect(
        decide(ordinary, [vote("elena", "organizer")], { pausedUntil: until, now: until }),
      ).toBe("approved");
    });
  });
});

describe("decideApprovals for any plan and answers", () => {
  const generate = (random: Parameters<typeof randomApprovalRequest>[0]) => {
    const request = randomApprovalRequest(random);
    const members = randomMembers(random);
    // The payee, when a member, answers in the role the request gives them.
    const payee = request.payee.member;
    const payeeIndex = payee === null ? -1 : Number(payee.memberId.split("-")[1]);
    if (payee !== null) members[payeeIndex] = payee.role;
    const votes = randomVotes(random, members);
    return {
      plan: planApprovals({ ...request, pausedUntil: null }),
      votes,
      shuffled: random.shuffle(votes),
      extra: randomVotes(random, members),
    };
  };
  const pending = (plan: ReturnType<typeof planApprovals>): plan is PendingPlan =>
    plan.outcome === "needs_approval";

  it("does not depend on the order of the answers", () => {
    forAll(generate, ({ plan, votes, shuffled }) => {
      if (!pending(plan)) return;
      expect(decide(plan, shuffled)).toBe(decide(plan, votes));
      expect(decide(plan, votes.toReversed())).toBe(decide(plan, votes));
    });
  });

  it("never approves on the payee's answers alone", () => {
    forAll(generate, ({ plan, votes }) => {
      if (!pending(plan) || plan.payeeMemberId === null) return;
      const own = votes.filter((each) => each.memberId === plan.payeeMemberId);
      expect(decide(plan, own)).not.toBe("approved");
    });
  });

  it("never approves with fewer members than it has places", () => {
    forAll(generate, ({ plan, votes }) => {
      if (!pending(plan) || decide(plan, votes) !== "approved") return;
      const yes = new Set(
        votes.filter((each) => each.decision === "approve").map((each) => each.memberId),
      );
      expect(yes.size).toBeGreaterThanOrEqual(plan.slots.length);
    });
  });

  it("is never undone by a further yes, and never rescued from a no", () => {
    forAll(generate, ({ plan, votes, extra }) => {
      if (!pending(plan)) return;
      const before = decide(plan, votes);
      const yeses = extra.map((each) => ({ ...each, decision: "approve" as const }));
      const after = decide(plan, [...votes, ...yeses]);
      if (before === "approved" || before === "rejected") expect(after).toBe(before);
      const withNo = [...votes, ...extra];
      if (before === "rejected") expect(decide(plan, withNo)).toBe("rejected");
    });
  });

  it("only ever answers one of its five outcomes", () => {
    forAll(generate, ({ plan, votes }) => {
      if (!pending(plan)) return;
      expect(["approved", "rejected", "expired", "paused", "pending"]).toContain(
        decide(plan, votes),
      );
    });
  });
});
