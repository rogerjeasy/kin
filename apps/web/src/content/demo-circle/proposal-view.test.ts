import { rosesMonth, settlePeriod } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { DEMO_NOW } from "./clock";
import { VIEWER } from "./members";
import { proposalView, waitingProposals } from "./proposal-view";
import { demoProposals, type DemoProposal } from "./proposals";

function proposal(id: string): DemoProposal {
  const found = demoProposals.find((each) => each.id === id);
  if (!found) throw new Error(`No demo proposal ${id}`);
  return found;
}

const HOUR_MS = 60 * 60 * 1000;

describe("the proposals waiting on the demo clock", () => {
  it("are all still pending, so the approvals screen has something to ask", () => {
    const waiting = waitingProposals();

    expect(waiting.map((view) => view.proposal.id)).toEqual(demoProposals.map((each) => each.id));
    expect(waiting.every((view) => view.decision === "pending")).toBe(true);
  });

  it("settle exactly what the money core plans for the month, and nothing else", () => {
    const { plan } = settlePeriod(rosesMonth);
    const settlement = demoProposals.filter((each) => each.purpose === "settlement");

    expect(settlement.map((each) => ({ to: each.to, cents: each.cents }))).toEqual(
      plan.payouts.map((payout) => ({ to: { memberId: payout.memberId }, cents: payout.cents })),
    );
  });

  it("all expire 72 hours after they were raised, and none has expired yet", () => {
    for (const view of waitingProposals()) {
      expect(view.plan.expiresAt.getTime() - view.proposal.raisedAt.getTime()).toBe(72 * HOUR_MS);
      expect(view.plan.expiresAt.getTime()).toBeGreaterThan(DEMO_NOW.getTime());
    }
  });
});

describe("the stairlift repair", () => {
  const view = proposalView(proposal("stairlift-repair"));

  it("needs Rose's yes and a second yes, because it is above both thresholds", () => {
    expect(view.plan.slots.map((slot) => slot.reason)).toEqual(["parent_decides", "second_approval"]);
  });

  it("shows Rose's spoken yes in her place, and the second place open to the siblings", () => {
    const [parent, second] = view.slots;

    expect(parent?.filledBy).toMatchObject({ memberId: "rose", method: "voice" });
    expect(second?.filledBy).toBeNull();
    expect(second?.waitingFor).toEqual(["elena", "marcus", "ana"]);
  });

  it("is announced to the whole circle, because the stairlift company is a new payee", () => {
    expect(view.plan.announceToCircle).toBe(true);
  });

  it("is Elena's turn", () => {
    expect(view.viewerCanAnswer).toBe(true);
  });

  it("is approved once Marcus adds his yes, as the approval engine decides it", () => {
    const answered = { ...proposal("stairlift-repair") };
    const withMarcus = proposalView({
      ...answered,
      votes: [...answered.votes, { memberId: "marcus", role: "contributor", decision: "approve", method: "app", at: DEMO_NOW }],
    });

    expect(withMarcus.decision).toBe("approved");
    expect(withMarcus.slots.every((slot) => slot.filledBy !== null)).toBe(true);
    expect(withMarcus.viewerCanAnswer).toBe(false);
  });

  it("is rejected by a no from a sibling whose yes could have counted", () => {
    const answered = proposal("stairlift-repair");
    const withNo = proposalView({
      ...answered,
      votes: [...answered.votes, { memberId: "ana", role: "contributor", decision: "reject", method: "app", at: DEMO_NOW }],
    });

    expect(withNo.decision).toBe("rejected");
  });
});

describe("Amara's week", () => {
  const view = proposalView(proposal("amara-week-44"));

  it("waits only for Rose, who decides above 50.00", () => {
    expect(view.slots).toHaveLength(1);
    expect(view.slots[0]?.reason).toBe("parent_decides");
    expect(view.slots[0]?.waitingFor).toEqual(["rose"]);
  });

  it("is not Elena's to answer", () => {
    expect(view.viewerCanAnswer).toBe(false);
  });
});

describe("the settlement payouts", () => {
  it("never ask Elena to approve the money paid to herself", () => {
    const view = proposalView(proposal("settlement-elena"));

    expect(view.plan.payeeMemberId).toBe("elena");
    expect(view.viewerCanAnswer).toBe(false);
    expect(view.slots.flatMap((slot) => slot.waitingFor)).not.toContain("elena");
  });

  it("ask the organizer to approve Ana's smaller payout", () => {
    const view = proposalView(proposal("settlement-ana"));

    expect(view.slots.map((slot) => slot.reason)).toEqual(["organizer"]);
    expect(view.viewerCanAnswer).toBe(true);
  });

  it("let only the viewer whose role fits answer", () => {
    const view = proposalView(proposal("settlement-ana"), { id: "marcus", role: "contributor" });

    expect(VIEWER.role).toBe("organizer");
    expect(view.viewerCanAnswer).toBe(false);
  });
});
