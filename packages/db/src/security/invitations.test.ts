import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { newCheckToken } from "../check-links.ts";
import { inviteMember } from "../invitations.ts";
import { acceptMyInvitations, createCircle, membershipsOf } from "../people.ts";
import { invitations, members } from "../schema/index.ts";
import { asPerson, asService } from "../scope.ts";
import { addMember, signedIn, visitorWithCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, countIn, errorCode } from "../testing/sql.ts";

const db = testDatabases();
const DAY_MS = 86_400_000;

async function realCircle() {
  const organizer = await signedIn(db.app, "Priya Shah");
  const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "decides", relationship: null }));
  const [own] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
  if (!own) throw new Error("The organizer has no seat");
  return { organizer, circleId, memberId: own.memberId };
}

const invitation = () => ({ email: `x-${randomUUID()}@example.com`, role: "observer" as const, expiresAt: new Date(Date.now() + DAY_MS), locale: "en", token: newCheckToken() });

describe("invitations between circles (AGENTS.md section 6)", () => {
  it("cannot be written into another circle, even by that other circle's organizer naming its own seat", async () => {
    const [mine, theirs] = [await realCircle(), await realCircle()];
    const attempt = asPerson(db.app, theirs.organizer, (tx) => inviteMember(tx, { circleId: mine.circleId, memberId: theirs.memberId, role: "organizer" }, invitation()));
    expect(await errorCode(attempt)).toBe(REFUSED.permission);
    expect(await asService(db.service, mine.circleId, (tx) => countIn(tx, "invitations", mine.circleId))).toBe(0);
    expect(await asService(db.service, mine.circleId, (tx) => countIn(tx, "outbox", mine.circleId))).toBe(0);
  });

  it("are refused to every role but the organizer, least privileged first", async () => {
    const circle = await visitorWithCircle(db);
    for (const role of ["observer", "caregiver", "contributor"] as const) {
      const member = await addMember(db, circle.circleId, role);
      const attempt = asPerson(db.app, member.userId, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: member.memberId, role }, invitation()));
      expect({ role, code: await errorCode(attempt) }).toEqual({ role, code: REFUSED.permission });
    }
  });

  it("are never read by someone with no seat, and the link answers nobody with an address", async () => {
    const circle = await realCircle();
    const sent = invitation();
    await asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: circle.memberId, role: "organizer" }, sent));
    const stranger = await signedIn(db.app, "Stranger");
    expect(await asPerson(db.app, stranger, (tx) => countIn(tx, "invitations", circle.circleId))).toBe(0);
    const status = await db.app.transaction((tx) => tx.execute<{ status: unknown }>(sql`select kin_private.invitation_link_status(${sent.token}) as status`));
    expect(JSON.stringify(status.rows[0]?.status)).not.toContain(sent.email);
  });

  it("are written and their links read only through the app's role, never the service's or the provisioner's", async () => {
    const circle = await realCircle();
    const token = newCheckToken();
    const invite = sql`select kin_private.invite_member(${circle.circleId}::uuid, 'x@example.com', 'observer'::circle_role, now() + interval '1 day', 'en', ${token})`;
    const look = sql`select kin_private.invitation_link_status(${token})`;
    for (const query of [invite, look]) {
      expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(query)))).toBe(REFUSED.permission);
      expect(await errorCode(db.provisioner.execute(query))).toBe(REFUSED.permission);
    }
  });

  it("are read by the service only for the circle it acts for", async () => {
    const [mine, theirs] = [await realCircle(), await realCircle()];
    await asPerson(db.app, mine.organizer, (tx) => inviteMember(tx, { circleId: mine.circleId, memberId: mine.memberId, role: "organizer" }, invitation()));
    expect(await asService(db.service, theirs.circleId, (tx) => countIn(tx, "invitations", mine.circleId))).toBe(0);
    expect(await asService(db.service, theirs.circleId, (tx) => countIn(tx, "outbox", mine.circleId))).toBe(0);
  });
});

describe("the parent seat an invitation names (AGENTS.md section 6)", () => {
  const parentSeatOf = async (circleId: string) => {
    const rows = await asService(db.service, circleId, (tx) => tx.select({ id: members.id }).from(members).where(and(eq(members.circleId, circleId), eq(members.role, "parent"))));
    const id = rows[0]?.id;
    if (!id) throw new Error("No parent seat");
    return id;
  };
  const parentInvitation = (seatMemberId: string) => ({ ...invitation(), role: "parent" as const, seatMemberId });

  it("cannot be another circle's, even named by an organizer of both", async () => {
    const [mine, theirs] = [await realCircle(), await realCircle()];
    const attempt = asPerson(db.app, mine.organizer, async (tx) => inviteMember(tx, { circleId: mine.circleId, memberId: mine.memberId, role: "organizer" }, parentInvitation(await parentSeatOf(theirs.circleId))));
    expect(await errorCode(attempt)).toBe("KI006");
  });

  it("is named only by an organizer, never a contributor", async () => {
    const circle = await realCircle();
    const email = `c-${randomUUID()}@example.com`;
    await asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: circle.memberId, role: "organizer" }, { ...invitation(), email, role: "contributor" }));
    const contributor = await signedIn(db.app, "Ravi", email);
    await asPerson(db.app, contributor, (tx) => acceptMyInvitations(tx));
    const [seat] = await asPerson(db.app, contributor, (tx) => membershipsOf(tx, contributor));
    if (!seat) throw new Error("The contributor has no seat");
    const seatId = await parentSeatOf(circle.circleId);
    const viaFunction = asPerson(db.app, contributor, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: seat.memberId, role: "contributor" }, parentInvitation(seatId)));
    expect(await errorCode(viaFunction)).toBe(REFUSED.permission);
    const viaInsert = asPerson(db.app, contributor, (tx) =>
      tx.insert(invitations).values({ id: randomUUID(), circleId: circle.circleId, email: `p-${randomUUID()}@example.com`, role: "parent", invitedBy: seat.memberId, expiresAt: new Date(Date.now() + DAY_MS), seatMemberId: seatId }),
    );
    expect(await errorCode(viaInsert)).toBe(REFUSED.permission);
  });

  it("cannot be set around the checks by the direct insert an organizer may make", async () => {
    const circle = await realCircle();
    const direct = (seatMemberId: string, role: "parent" | "observer") =>
      asPerson(db.app, circle.organizer, (tx) =>
        tx.insert(invitations).values({ id: randomUUID(), circleId: circle.circleId, email: `d-${randomUUID()}@example.com`, role, invitedBy: circle.memberId, expiresAt: new Date(Date.now() + DAY_MS), seatMemberId }),
      );
    // The organizer's own seat is not a parent's, and a seat is only for a parent's invitation.
    expect(await errorCode(direct(circle.memberId, "parent"))).toBe("KI006");
    expect(await errorCode(direct(await parentSeatOf(circle.circleId), "observer"))).toBe("KI006");
    // A parent's invitation with no seat while the seat is unclaimed must say which.
    const unnamed = asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: circle.memberId, role: "organizer" }, { ...invitation(), role: "parent" }));
    expect(await errorCode(unnamed)).toBe("KI008");
  });

  it("is taken only by the invitation that names it, never by another address", async () => {
    const circle = await realCircle();
    const seatId = await parentSeatOf(circle.circleId);
    const named = `named-${randomUUID()}@example.com`;
    await asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: circle.memberId, role: "organizer" }, { ...parentInvitation(seatId), email: named }));
    const intruder = `intruder-${randomUUID()}@example.com`;
    await asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, { circleId: circle.circleId, memberId: circle.memberId, role: "organizer" }, { ...invitation(), email: intruder, role: "contributor" }));
    const stranger = await signedIn(db.app, "Stranger", intruder);
    await asPerson(db.app, stranger, (tx) => acceptMyInvitations(tx));
    const heldBy = async () => (await asService(db.service, circle.circleId, (tx) => tx.select({ userId: members.userId }).from(members).where(eq(members.id, seatId))))[0]?.userId;
    expect(await heldBy()).toBeNull();
    const parent = await signedIn(db.app, "Meera", named);
    await asPerson(db.app, parent, (tx) => acceptMyInvitations(tx));
    expect(await heldBy()).toBe(parent);
  });

  it("is counted by invitation emails for Kin's service only", async () => {
    const query = sql`select kin_private.invitation_emails_sent_today()`;
    const person = await signedIn(db.app, "Someone");
    expect(await errorCode(asPerson(db.app, person, (tx) => tx.execute(query)))).toBe(REFUSED.permission);
    expect(await errorCode(db.provisioner.execute(query))).toBe(REFUSED.permission);
    const count = await db.service.execute<{ n: number }>(sql`select kin_private.invitation_emails_sent_today() as n`);
    expect(Number(count.rows[0]?.n)).toBeGreaterThanOrEqual(0);
  });
});
