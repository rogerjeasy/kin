import type { AgreementTerms } from "@kin/domain";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { acceptAgreement, proposeAgreement } from "./agreements.ts";
import { configureCaregiver, submitCaregiverBill } from "./caregiver-billing.ts";
import { sendCaregiverBill } from "./caregiver-review.ts";
import { createCircle, membershipsOf, takeDemoSeat } from "./people.ts";
import { readCircle } from "./read-circle.ts";
import { agreementShares, auditLog, proposals } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { seatPerson, signedIn, visitorWithCircle, type VisitorCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const TODAY = "2026-10-30";

const read = (circle: VisitorCircle, userId = circle.userId) => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));
const as = (circle: VisitorCircle, persona: keyof VisitorCircle["members"]) => asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, circle.members[persona]));
const terms = (circle: VisitorCircle, change: Partial<AgreementTerms> = {}): AgreementTerms => ({
  shares: [{ memberId: circle.members.marcus, bps: 4500 }, { memberId: circle.members.elena, bps: 3000 }, { memberId: circle.members.ana, bps: 2500 }],
  care: { rateCentsPerHour: 2000, paidInCash: false },
  approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 40_000, parentDecidesAboveCents: 5_000 },
  effectiveOn: TODAY,
  ...change,
});
const propose = (circle: VisitorCircle, change: Partial<AgreementTerms> = {}) => asPerson(db.app, circle.userId, (tx) => proposeAgreement(tx, { circleId: circle.circleId, terms: terms(circle, change) }));
const accept = (circle: VisitorCircle, agreementId: string) => asPerson(db.app, circle.userId, (tx) => acceptAgreement(tx, { circleId: circle.circleId, agreementId }));
const inForceInSql = async (circle: VisitorCircle) => {
  const result = await asService(db.service, circle.circleId, (tx) => tx.execute<{ version: number }>(sql`select version from kin_private.agreement_in_force(${circle.circleId})`));
  return result.rows[0]?.version ?? null;
};

describe("a new version of the family agreement", () => {
  it("waits for every member who shares the cost, with the proposer counted as accepting, and then governs", async () => {
    const circle = await visitorWithCircle(db);
    const id = await propose(circle);
    let seen = await read(circle);
    expect(seen.agreement?.version).toBe(1);
    expect(seen.agreementVersions.map((version) => [version.version, version.status])).toEqual([[1, "in_force"], [2, "awaiting"]]);
    expect(seen.agreementVersions[1]?.waitingFor).toEqual([circle.members.marcus, circle.members.ana]);

    await as(circle, "marcus");
    await accept(circle, id);
    await accept(circle, id);
    expect((await read(circle)).agreement?.version).toBe(1);
    await as(circle, "ana");
    await accept(circle, id);
    seen = await read(circle);
    expect(seen.agreement).toMatchObject({ version: 2, approvals: { secondApprovalAboveCents: 40_000 } });
    expect(seen.agreementVersions.map((version) => version.status)).toEqual(["earlier", "in_force"]);
    expect(await inForceInSql(circle)).toBe(2);

    const audit = await asService(db.service, circle.circleId, (tx) => tx.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.subjectId, id))));
    expect(audit.map((row) => row.action)).toEqual(["agreement.proposed", "agreement.accepted", "agreement.accepted"]);
  });

  it("cannot be made the organizer's alone by writing themselves the only share", async () => {
    const circle = await visitorWithCircle(db);
    // The organizer takes the whole cost, lifts the limits, and asks nobody: refused in effect.
    const id = await propose(circle, {
      shares: [{ memberId: circle.members.elena, bps: 10_000 }],
      approvals: { ceilingCents: 10_000_000, secondApprovalAboveCents: 10_000_000, parentDecidesAboveCents: 10_000_000 },
    });
    const version = (await read(circle)).agreementVersions.find((each) => each.id === id);
    expect(version?.status).toBe("awaiting");
    expect(version?.waitingFor).toEqual(expect.arrayContaining([circle.members.marcus, circle.members.ana]));
    expect((await read(circle)).agreement?.version).toBe(1);
    expect(await inForceInSql(circle)).toBe(1);
    // Marcus alone is not enough either: every organizer and contributor is asked.
    await as(circle, "marcus");
    await accept(circle, id);
    expect(await inForceInSql(circle)).toBe(1);
  });

  it("asks a parent who decides, when someone holds the parent's seat", async () => {
    const circle = await visitorWithCircle(db);
    await seatPerson(db, circle.circleId, circle.members.rose);
    const id = await propose(circle);
    const version = (await read(circle)).agreementVersions.find((each) => each.id === id);
    expect(version?.waitingFor).toEqual(expect.arrayContaining([circle.members.marcus, circle.members.ana, circle.members.rose]));
  });

  it("lets the parent accept as well, without the version waiting for them", async () => {
    const circle = await visitorWithCircle(db);
    const id = await propose(circle);
    await as(circle, "rose");
    await accept(circle, id);
    const version = (await read(circle)).agreementVersions.find((each) => each.id === id);
    expect(version?.acceptances.map((each) => each.memberId)).toContain(circle.members.rose);
    expect(version?.status).toBe("awaiting");
  });

  it("is proposed only by an organizer, and accepted only by a member who shares the cost or the parent", async () => {
    const circle = await visitorWithCircle(db);
    const id = await propose(circle);
    for (const persona of ["marcus", "rose", "daniel", "amara"] as const) {
      await as(circle, persona);
      await expect(propose(circle)).rejects.toMatchObject({ reason: "refused" });
    }
    for (const persona of ["daniel", "amara"] as const) {
      await as(circle, persona);
      await expect(accept(circle, id)).rejects.toMatchObject({ reason: "refused" });
    }
  });

  it("refuses terms the money core could not run on, even passed straight to the database", async () => {
    const circle = await visitorWithCircle(db);
    const bad: Partial<AgreementTerms>[] = [
      { shares: [{ memberId: circle.members.marcus, bps: 5000 }, { memberId: circle.members.elena, bps: 4999 }] },
      { shares: [{ memberId: circle.members.amara, bps: 10_000 }] },
      { shares: [{ memberId: circle.members.rose, bps: 10_000 }] },
      { shares: [{ memberId: circle.members.marcus, bps: 5000 }, { memberId: circle.members.marcus, bps: 5000 }] },
      { shares: [] },
      { effectiveOn: "2026-10-29" },
      { approvals: { ceilingCents: 100, secondApprovalAboveCents: 200, parentDecidesAboveCents: 0 } },
      { approvals: { ceilingCents: 0, secondApprovalAboveCents: 0, parentDecidesAboveCents: 0 } },
      { care: { rateCentsPerHour: 0, paidInCash: true } },
    ];
    for (const change of bad) await expect(propose(circle, change), JSON.stringify(change)).rejects.toMatchObject({ reason: "invalid" });
    expect((await read(circle)).agreementVersions).toHaveLength(1);
  });

  it("replaces an older proposal nobody finished accepting, which can then no longer be accepted", async () => {
    const circle = await visitorWithCircle(db);
    const second = await propose(circle);
    const third = await propose(circle, { approvals: { ceilingCents: 200_000, secondApprovalAboveCents: 40_000, parentDecidesAboveCents: 5_000 } });
    await as(circle, "marcus");
    await expect(accept(circle, second)).rejects.toMatchObject({ reason: "superseded" });
    await accept(circle, third);
    expect((await read(circle)).agreementVersions.map((version) => version.status)).toEqual(["in_force", "superseded", "awaiting"]);
  });

  it("takes effect on its start date, not before", async () => {
    const circle = await visitorWithCircle(db);
    const id = await propose(circle, { effectiveOn: "2026-11-01" });
    for (const persona of ["marcus", "ana"] as const) {
      await as(circle, persona);
      await accept(circle, id);
    }
    expect((await read(circle)).agreementVersions.map((version) => version.status)).toEqual(["in_force", "scheduled"]);
    expect(await inForceInSql(circle)).toBe(1);
  });

  it("keeps the shares in the order the family wrote them", async () => {
    const circle = await visitorWithCircle(db);
    const id = await propose(circle);
    const rows = await asService(db.service, circle.circleId, (tx) => tx.select().from(agreementShares).where(eq(agreementShares.agreementId, id)).orderBy(agreementShares.position));
    expect(rows.map((row) => row.memberId)).toEqual([circle.members.marcus, circle.members.elena, circle.members.ana]);
  });

  it("is never shown to a caregiver", async () => {
    const circle = await visitorWithCircle(db);
    await propose(circle);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    const seen = await read(circle, caregiver);
    expect([seen.agreement, seen.agreementVersions]).toEqual([null, []]);
  });
});

describe("the agreement a caregiver's payout is planned against", () => {
  it("is the one in force, never a proposal still waiting", async () => {
    const circle = await visitorWithCircle(db);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 2200 }));
    const bill = (date: string) => asPerson(db.app, caregiver, (tx) => submitCaregiverBill(tx, { circleId: circle.circleId, details: { version: 1, currency: "USD", rateCentsPerHour: 2200, visits: [{ date, minutes: 240 }] }, submissionKey: randomUUID() }));
    const send = async (billId: string) => {
      const proposalId = await asPerson(db.app, circle.userId, (tx) => sendCaregiverBill(tx, { circleId: circle.circleId, billId, now: CLOCK }));
      const [row] = await asService(db.service, circle.circleId, (tx) => tx.select().from(proposals).where(eq(proposals.id, proposalId)));
      return row;
    };
    // Version 2 would ask for a second yes above 50.00; 88.00 is above that, but below version 1's 500.00.
    const id = await propose(circle, { approvals: { ceilingCents: 300_000, secondApprovalAboveCents: 5_000, parentDecidesAboveCents: 5_000 } });
    const before = await send(await bill("2026-10-20"));
    expect([before?.agreementVersion, (before?.plan as { slots: unknown[] }).slots.length]).toEqual([1, 1]);

    for (const persona of ["marcus", "ana"] as const) {
      await as(circle, persona);
      await accept(circle, id);
    }
    await as(circle, "elena");
    const after = await send(await bill("2026-10-21"));
    expect([after?.agreementVersion, (after?.plan as { slots: unknown[] }).slots.length]).toEqual([2, 2]);
  });
});

describe("a real circle's first agreement", () => {
  it("governs at once when the organizer is the only member who shares the cost", async () => {
    const organizer = await signedIn(db.app, "Priya Shah");
    const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "decides", relationship: null }));
    const [seat] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
    if (!seat) throw new Error("The organizer has no seat");
    const today = new Date().toISOString().slice(0, 10);
    await asPerson(db.app, organizer, (tx) =>
      proposeAgreement(tx, { circleId, terms: { shares: [{ memberId: seat.memberId, bps: 10_000 }], care: null, approvals: { ceilingCents: 200_000, secondApprovalAboveCents: 50_000, parentDecidesAboveCents: 10_000 }, effectiveOn: today } }),
    );
    const seen = await asPerson(db.app, organizer, (tx) => readCircle(tx, { circleId, userId: organizer, now: new Date() }));
    expect(seen.agreement).toMatchObject({ version: 1, shares: [{ memberId: seat.memberId, bps: 10_000 }], care: null });
  });
});
