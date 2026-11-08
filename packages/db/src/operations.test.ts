import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ProposalClosedError, answerProposal, inviteMember, pauseCircle, resumeCircle, type Seat } from "./operations.ts";
import { acceptMyInvitations, createCircle, createDemoVisitor, membershipsOf, takeDemoSeat } from "./people.ts";
import { readCircle } from "./read-circle.ts";
import { approvals, auditLog, members, payees, proposals } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { signedIn, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { REFUSED, errorCode } from "./testing/sql.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");

const read = (userId: string, circleId: string) => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId, userId, now: new Date() }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
const seatOf = async (circle: VisitorCircle): Promise<Seat> => {
  const snapshot = await read(circle.userId, circle.circleId);
  return { circleId: circle.circleId, memberId: snapshot.viewer.memberId, role: snapshot.viewer.role };
};
const proposalOf = async (circle: VisitorCircle, purpose: string) => {
  const [row] = await asService(db.service, circle.circleId, (tx) => tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.purpose, purpose)));
  if (!row) throw new Error(`No ${purpose} proposal`);
  return row.id;
};
const answer = async (circle: VisitorCircle, proposalId: string, decision: "approve" | "reject") =>
  asPerson(db.app, circle.userId, async (tx) => answerProposal(tx, await seatOf(circle), { proposalId, decision, method: "app", now: CLOCK, pausedUntil: null }));

describe("a demo visitor playing every role", () => {
  it("takes another persona's seat and sees the circle as that role", async () => {
    const circle = await visitorWithCircle(db);
    for (const [persona, role] of [["marcus", "contributor"], ["rose", "parent"], ["amara", "caregiver"], ["daniel", "observer"], ["elena", "organizer"]] as const) {
      await as(circle, persona);
      const snapshot = await read(circle.userId, circle.circleId);
      expect(snapshot.viewer).toEqual({ memberId: circle.members[persona], role });
    }
  });

  it("sees what the role may see: as Amara, only her own pay", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "amara");
    const snapshot = await read(circle.userId, circle.circleId);
    expect(snapshot.agreement).toBeNull();
    // Her two paid shifts, and her week waiting for Rose.
    expect(snapshot.proposals.map((proposal) => proposal.purpose)).toEqual(["shift", "shift", "caregiverWeek"]);
  });

  it("cannot take a seat in someone else's demo circle, or a seat another visitor holds", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    expect(await errorCode(asPerson(db.app, mine.userId, (tx) => takeDemoSeat(tx, theirs.circleId, theirs.members.marcus)))).toBe(REFUSED.permission);
    const other = await createDemoVisitor(db.app);
    await asService(db.service, mine.circleId, (tx) => tx.update(members).set({ userId: other }).where(eq(members.id, mine.members.marcus)));
    expect(await errorCode(as(mine, "marcus"))).toBe(REFUSED.permission);
  });
});

describe("demo and real kept apart", () => {
  it("never seats a signed-in person in a demo circle", async () => {
    const circle = await visitorWithCircle(db);
    const person = await signedIn(db.app);
    const seat = asService(db.service, circle.circleId, (tx) => tx.update(members).set({ userId: person }).where(eq(members.id, circle.members.marcus)));
    expect(await errorCode(seat)).toBe(REFUSED.check);
  });

  it("never lets a demo visitor start a real circle", async () => {
    const visitor = await createDemoVisitor(db.app);
    const attempt = asPerson(db.app, visitor, (tx) => createCircle(tx, { name: "Fake", timezone: "UTC", currency: "USD", parentName: "Mum", parentLevel: "decides", relationship: null }));
    expect(await errorCode(attempt)).toBe(REFUSED.permission);
  });
});

describe("answering a proposal", () => {
  it("approves the stairlift once a sibling adds the second yes to Rose's", async () => {
    const circle = await visitorWithCircle(db);
    const stairlift = await proposalOf(circle, "stairlift");
    await as(circle, "marcus");
    expect(await answer(circle, stairlift, "approve")).toBe("approved");
    const snapshot = await read(circle.userId, circle.circleId);
    expect(snapshot.proposals.find((proposal) => proposal.id === stairlift)).toMatchObject({ state: "approved" });
    const audit = await asService(db.service, circle.circleId, (tx) => tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, stairlift)));
    expect(audit.map((row) => row.action)).toEqual(["proposal.answered"]);
  });

  it("keeps it waiting when the yes does not fill every place, and rejects it on a no", async () => {
    const circle = await visitorWithCircle(db);
    const week = await proposalOf(circle, "caregiverWeek");
    // Amara's week needs Rose. Elena's yes does not fill that place.
    expect(await answer(circle, week, "approve")).toBe("pending");
    await as(circle, "rose");
    expect(await answer(circle, week, "reject")).toBe("rejected");
    await expect(answer(circle, week, "approve")).rejects.toThrow(ProposalClosedError);
  });

  it("takes one answer per member", async () => {
    const circle = await visitorWithCircle(db);
    const week = await proposalOf(circle, "caregiverWeek");
    await answer(circle, week, "approve");
    expect(await errorCode(answer(circle, week, "approve"))).toBe(REFUSED.unique);
  });

  it.each(["daniel", "amara"] as const)("is refused to %s, an observer or a caregiver, by the database", async (persona) => {
    const circle = await visitorWithCircle(db);
    const week = await proposalOf(circle, "caregiverWeek");
    await as(circle, persona);
    // They may not even lock the proposal to answer it.
    await expect(answer(circle, week, "approve")).rejects.toThrow(ProposalClosedError);
    // And an answer written straight into the table is refused too.
    const seat = await seatOf(circle);
    const direct = asPerson(db.app, circle.userId, (tx) =>
      tx.insert(approvals).values({ id: randomUUID(), circleId: circle.circleId, proposalId: week, memberId: seat.memberId, role: seat.role, decision: "approve", method: "app", decidedAt: CLOCK }),
    );
    expect(await errorCode(direct)).toBe(REFUSED.permission);
  });

  it("is refused in another member's name or role", async () => {
    const circle = await visitorWithCircle(db);
    const week = await proposalOf(circle, "caregiverWeek");
    const forged = asPerson(db.app, circle.userId, (tx) =>
      tx.insert(approvals).values({ id: randomUUID(), circleId: circle.circleId, proposalId: week, memberId: circle.members.rose, role: "parent", decision: "approve", method: "voice", decidedAt: CLOCK }),
    );
    expect(await errorCode(forged)).toBe(REFUSED.permission);
  });
});

describe("the pause switch", () => {
  it("lets any member but an observer pause, and only the organizer or the one who paused lift it", async () => {
    const circle = await visitorWithCircle(db);
    const until = new Date(CLOCK.getTime() + 24 * 60 * 60 * 1000);
    await as(circle, "amara");
    await asPerson(db.app, circle.userId, async (tx) => pauseCircle(tx, await seatOf(circle), until));
    expect((await read(circle.userId, circle.circleId)).circle.pausedUntil).toEqual(until);

    await as(circle, "marcus");
    expect(await errorCode(asPerson(db.app, circle.userId, async (tx) => resumeCircle(tx, await seatOf(circle))))).toBe(REFUSED.permission);
    await as(circle, "elena");
    await asPerson(db.app, circle.userId, async (tx) => resumeCircle(tx, await seatOf(circle)));
    expect((await read(circle.userId, circle.circleId)).circle.pausedUntil).toBeNull();
  });

  it("lasts at most 24 hours on the circle's clock", async () => {
    const circle = await visitorWithCircle(db);
    const tooLong = new Date(CLOCK.getTime() + 25 * 60 * 60 * 1000);
    expect(await errorCode(asPerson(db.app, circle.userId, async (tx) => pauseCircle(tx, await seatOf(circle), tooLong)))).toBe(REFUSED.check);
  });
});

describe("a real circle", () => {
  it("is started by a signed-in person, who organizes it, with the parent as its first member and no data yet", async () => {
    const person = await signedIn(db.app, "Priya Shah");
    const circleId = await asPerson(db.app, person, (tx) =>
      createCircle(tx, { name: "Mum's circle", timezone: "Europe/London", currency: "USD", parentName: "Meera", parentLevel: "informed", relationship: "daughter" }),
    );
    const snapshot = await read(person, circleId);
    expect(snapshot.circle).toMatchObject({ name: "Mum's circle", demo: false, timezone: "Europe/London" });
    // Both joined in the same instant, so their order is not part of the contract.
    expect(snapshot.members.map((member) => [member.displayName, member.role, member.parentLevel]).toSorted()).toEqual([
      ["Meera", "parent", "informed"],
      ["Priya Shah", "organizer", null],
    ]);
    expect([snapshot.ledger.entries, snapshot.proposals, snapshot.payees, snapshot.agreement]).toEqual([[], [], [], null]);
  });

  it("refuses a timezone that does not exist", async () => {
    const person = await signedIn(db.app);
    const attempt = asPerson(db.app, person, (tx) => createCircle(tx, { name: "X", timezone: "Mars/Olympus", currency: "USD", parentName: "Mum", parentLevel: "decides", relationship: null }));
    expect(await errorCode(attempt)).toBe(REFUSED.check);
  });

  it("is joined by the person an organizer invited, once their address is verified", async () => {
    const organizer = await signedIn(db.app, "Priya Shah");
    const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "decides", relationship: null }));
    const [seat] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
    if (!seat) throw new Error("The organizer has no seat");
    const email = `brother-${randomUUID()}@example.com`;
    await asPerson(db.app, organizer, (tx) => inviteMember(tx, { circleId, memberId: seat.memberId, role: "organizer" }, { email, role: "contributor", expiresAt: new Date(Date.now() + 86_400_000) }));

    const brother = await signedIn(db.app, "Ravi Shah", email.toUpperCase());
    expect(await asPerson(db.app, brother, (tx) => acceptMyInvitations(tx))).toBe(1);
    expect((await asPerson(db.app, brother, (tx) => membershipsOf(tx, brother))).map((each) => [each.circleId, each.role])).toEqual([[circleId, "contributor"]]);
    // Accepting again changes nothing.
    expect(await asPerson(db.app, brother, (tx) => acceptMyInvitations(tx))).toBe(0);
  });

  it("lets only an organizer invite", async () => {
    const circle = await visitorWithCircle(db);
    await as(circle, "marcus");
    const attempt = asPerson(db.app, circle.userId, async (tx) => inviteMember(tx, await seatOf(circle), { email: "x@example.com", role: "observer", expiresAt: new Date(Date.now() + 86_400_000) }));
    expect(await errorCode(attempt)).toBe(REFUSED.permission);
  });
});

describe("a decision the stored plan does not support", () => {
  const decide = (circle: VisitorCircle, proposalId: string, state: "approved" | "rejected" | "expired") =>
    errorCode(asPerson(db.app, circle.userId, (tx) => tx.update(proposals).set({ state }).where(eq(proposals.id, proposalId))));
  const vote = async (circle: VisitorCircle, proposalId: string, decision: "approve" | "reject") => {
    const seat = await seatOf(circle);
    await asPerson(db.app, circle.userId, (tx) =>
      tx.insert(approvals).values({ id: randomUUID(), circleId: circle.circleId, proposalId, memberId: seat.memberId, role: seat.role, decision, method: "app", decidedAt: CLOCK }),
    );
  };

  it("is refused when fewer members said yes than the plan has places", async () => {
    const circle = await visitorWithCircle(db);
    const stairlift = await proposalOf(circle, "stairlift");
    // Rose's spoken yes fills one of two places. Marcus has not answered.
    await as(circle, "marcus");
    expect(await decide(circle, stairlift, "approved")).toBe(REFUSED.check);
  });

  it("is refused when the member being paid is the only one who said yes", async () => {
    const circle = await visitorWithCircle(db);
    const [own] = await asService(db.service, circle.circleId, (tx) =>
      tx.select({ id: proposals.id }).from(proposals).where(eq(proposals.memberId, circle.members.elena)),
    );
    if (!own) throw new Error("Elena has no settlement payout");
    await vote(circle, own.id, "approve");
    expect(await decide(circle, own.id, "approved")).toBe(REFUSED.check);
  });

  it("is refused when anyone said no, and a rejection needs a no", async () => {
    const circle = await visitorWithCircle(db);
    const week = await proposalOf(circle, "caregiverWeek");
    expect(await decide(circle, week, "rejected")).toBe(REFUSED.check);
    await vote(circle, week, "reject");
    await as(circle, "rose");
    await vote(circle, week, "approve");
    expect(await decide(circle, week, "approved")).toBe(REFUSED.check);
  });

  it("is refused as expired before the proposal's time is up", async () => {
    const circle = await visitorWithCircle(db);
    expect(await decide(circle, await proposalOf(circle, "stairlift"), "expired")).toBe(REFUSED.check);
  });
});

describe("a real circle's proposals", () => {
  async function realProposal() {
    const organizer = await signedIn(db.app, "Priya Shah");
    const circleId = await asPerson(db.app, organizer, (tx) =>
      createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "decides", relationship: null }),
    );
    const payeeId = randomUUID();
    const proposalId = randomUUID();
    await asService(db.service, circleId, async (tx) => {
      await tx.insert(payees).values({ id: payeeId, circleId, name: "City Water", category: "utilities", status: "approved" });
      await tx.insert(proposals).values({
        id: proposalId,
        circleId,
        kind: "bill_payment",
        cents: 6100,
        payeeId,
        purpose: "bill",
        raisedAt: CLOCK,
        state: "pending_approval",
        expiresAt: new Date(CLOCK.getTime() + 72 * 3_600_000),
        agreementVersion: 1,
        plan: { outcome: "needs_approval", slots: [{ reason: "organizer", roles: ["organizer"] }], payeeMemberId: null, announceToCircle: false, expiresAt: new Date(CLOCK.getTime() + 72 * 3_600_000).toISOString() },
      });
    });
    const [seat] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
    if (!seat) throw new Error("The organizer has no seat");
    return { organizer, circleId, proposalId, memberId: seat.memberId };
  }

  it("take no yes from a person without the fresh multi-factor check's evidence", async () => {
    const real = await realProposal();
    const answer = asPerson(db.app, real.organizer, (tx) =>
      tx.insert(approvals).values({ id: randomUUID(), circleId: real.circleId, proposalId: real.proposalId, memberId: real.memberId, role: "organizer", decision: "approve", method: "app", decidedAt: CLOCK }),
    );
    expect(await errorCode(answer)).toBe(REFUSED.permission);
  });

  it("cannot be moved by a person without the answers its plan needs", async () => {
    const real = await realProposal();
    const rejected = asPerson(db.app, real.organizer, (tx) => tx.update(proposals).set({ state: "rejected" }).where(eq(proposals.id, real.proposalId)));
    expect(await errorCode(rejected)).toBe(REFUSED.check);
    const approved = asPerson(db.app, real.organizer, (tx) => tx.update(proposals).set({ state: "approved" }).where(eq(proposals.id, real.proposalId)));
    expect(await errorCode(approved)).toBe(REFUSED.check);
  });
});
