import { APPROVAL_WINDOW_HOURS, rosesMonth, settlePeriod } from "@kin/domain";
import { snapshotFor, testDatabases, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import type { CircleSnapshot, ProposalRecord } from "@kin/db";
import { beforeAll, describe, expect, it } from "vitest";

import { proposalView, waitingProposals } from "./proposal-view";

const HOUR_MS = 60 * 60 * 1000;
const db = testDatabases();
let circle: CircleSnapshot;
let ids: VisitorCircle;

beforeAll(async () => {
  ids = await visitorWithCircle(db);
  circle = await snapshotFor(db, ids.userId, ids.circleId);
});

function byPurpose(purpose: string, memberId?: string): ProposalRecord {
  const proposal = circle.proposals.find((each) => each.purpose === purpose && (memberId === undefined || ("memberId" in each.to && each.to.memberId === memberId)));
  if (!proposal) throw new Error(`No ${purpose} proposal`);
  return proposal;
}

function view(proposal: ProposalRecord, snapshot: CircleSnapshot = circle) {
  const result = proposalView(snapshot, proposal);
  if (!result) throw new Error("The proposal does not wait for approval");
  return result;
}

describe("the proposals on the demo clock", () => {
  it("are all still pending, so the approvals screen has something to ask", () => {
    const waiting = waitingProposals(circle);
    expect(waiting).toHaveLength(circle.proposals.length);
    expect(waiting.every((each) => each.decision === "pending")).toBe(true);
  });

  it("settle exactly what the money core plans for the month, and nothing else", () => {
    const settled = circle.proposals.filter((each) => each.purpose === "settlement").map((each) => [("memberId" in each.to ? each.to.memberId : ""), each.cents]);
    const planned = settlePeriod(rosesMonth).plan.payouts.map((payout) => [ids.members[payout.memberId as "elena" | "ana"], payout.cents]);
    expect(settled.toSorted()).toEqual(planned.toSorted());
  });

  it("all expire 72 hours after they were raised, and none has expired yet", () => {
    for (const each of waitingProposals(circle)) {
      expect(each.plan.expiresAt.getTime() - each.proposal.raisedAt.getTime()).toBe(APPROVAL_WINDOW_HOURS * HOUR_MS);
      expect(each.plan.expiresAt.getTime()).toBeGreaterThan(circle.circle.now.getTime());
    }
  });
});

describe("the stairlift repair", () => {
  it("needs Rose's yes and a second yes, because it is above both thresholds", () => {
    expect(view(byPurpose("stairlift")).plan.slots.map((slot) => slot.reason)).toEqual(["parent_decides", "second_approval"]);
  });

  it("shows Rose's spoken yes in her place, and the second place open to the siblings", () => {
    const [parent, second] = view(byPurpose("stairlift")).slots;
    expect(parent?.filledBy).toMatchObject({ memberId: ids.members.rose, method: "voice" });
    expect(second?.filledBy).toBeNull();
    expect(second?.waitingFor).toEqual([ids.members.elena, ids.members.marcus, ids.members.ana]);
  });

  it("is announced to the whole circle, because the stairlift company is a new payee, and is Elena's turn", () => {
    const stairlift = view(byPurpose("stairlift"));
    expect(stairlift.plan.announceToCircle).toBe(true);
    expect(stairlift.viewerCanAnswer).toBe(true);
  });

  it("is approved once Marcus adds his yes, and rejected by a no from a sibling", () => {
    const proposal = byPurpose("stairlift");
    const marcus = { memberId: ids.members.marcus, role: "contributor" as const, method: "app" as const, at: circle.circle.now };
    const withYes = view({ ...proposal, votes: [...proposal.votes, { ...marcus, decision: "approve" }] });
    expect(withYes.decision).toBe("approved");
    expect(withYes.viewerCanAnswer).toBe(false);
    expect(view({ ...proposal, votes: [...proposal.votes, { ...marcus, decision: "reject" }] }).decision).toBe("rejected");
  });

  it("holds while the circle is paused, whatever the answers", () => {
    const paused = { ...circle, circle: { ...circle.circle, pausedUntil: new Date(circle.circle.now.getTime() + HOUR_MS) } };
    expect(view(byPurpose("stairlift"), paused).decision).toBe("paused");
    // Held, not closed: they stay on the screen, marked as paused.
    expect(waitingProposals(paused).map((each) => each.decision)).toEqual(circle.proposals.map(() => "paused"));
  });
});

describe("the settlement payouts", () => {
  it("never ask Elena to approve the money paid to herself", () => {
    const elena = view(byPurpose("settlement", ids.members.elena));
    expect(elena.plan.payeeMemberId).toBe(ids.members.elena);
    expect(elena.viewerCanAnswer).toBe(false);
    expect(elena.slots.flatMap((slot) => slot.waitingFor)).not.toContain(ids.members.elena);
  });

  it("ask the organizer to approve Ana's smaller payout", () => {
    const ana = view(byPurpose("settlement", ids.members.ana));
    expect(ana.slots.map((slot) => slot.reason)).toEqual(["organizer"]);
    expect(ana.viewerCanAnswer).toBe(true);
  });
});

describe("Amara's week", () => {
  it("waits only for Rose, who decides above 50.00, and is not Elena's to answer", () => {
    const amara = view(byPurpose("caregiverWeek"));
    expect(amara.slots.map((slot) => [slot.reason, slot.waitingFor])).toEqual([["parent_decides", [ids.members.rose]]]);
    expect(amara.viewerCanAnswer).toBe(false);
  });
});
