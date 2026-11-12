import { randomUUID } from "node:crypto";
import type { CircleRole } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { claimOutbox } from "./payouts.ts";
import { hashCheckToken, newCheckToken } from "./check-links.ts";
import { INVITATION_EMAIL_TOPIC, InvitationError, inviteMember, readInvitationEmailFacts, readInvitationLink, recordInvitationEmailed } from "./invitations.ts";
import type { Seat } from "./operations.ts";
import { acceptMyInvitations, createCircle, membershipsOf } from "./people.ts";
import { auditLog, invitations, members, outbox } from "./schema/index.ts";
import { asPerson, asService } from "./scope.ts";
import { signedIn, visitorWithCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";
import { errorCode } from "./testing/sql.ts";
import { readCircle } from "./read-circle.ts";

const db = testDatabases();
const DAY_MS = 86_400_000;

type RealCircle = { readonly organizer: string; readonly circleId: string; readonly seat: Seat };

async function realCircle(parentName = "Meera"): Promise<RealCircle> {
  const organizer = await signedIn(db.app, "Priya Shah");
  const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName, parentLevel: "informed", relationship: null }));
  const [own] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
  if (!own) throw new Error("The organizer has no seat");
  return { organizer, circleId, seat: { circleId, memberId: own.memberId, role: "organizer" } };
}

const invite = (circle: RealCircle, email: string, role: CircleRole, token = newCheckToken(), seatMemberId: string | null = null) =>
  asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, circle.seat, { email, role, expiresAt: new Date(Date.now() + 14 * DAY_MS), locale: "fr", token, seatMemberId }));
/** Invites the parent to the seat the organizer made for her when starting the circle. */
const inviteToPlaceholder = async (circle: RealCircle, email: string) => {
  const [placeholder] = await parentsOf(circle.circleId);
  if (!placeholder) throw new Error("The circle has no parent seat");
  return invite(circle, email, "parent", newCheckToken(), placeholder.id);
};

const reasonOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof InvitationError ? error.reason : String(error);
  }
};

const address = () => `person-${randomUUID()}@example.com`;
const messagesOf = (circleId: string) =>
  asService(db.service, circleId, (tx) => tx.select({ payload: outbox.payload }).from(outbox).where(and(eq(outbox.circleId, circleId), eq(outbox.topic, INVITATION_EMAIL_TOPIC))));
const parentsOf = (circleId: string) =>
  asService(db.service, circleId, (tx) => tx.select({ id: members.id, userId: members.userId, name: members.displayName, level: members.parentLevel }).from(members).where(and(eq(members.circleId, circleId), eq(members.role, "parent"))));

describe("an invitation to a real circle", () => {
  it("queues one email carrying the link's token, while the invitation keeps only its hash", async () => {
    const circle = await realCircle();
    const token = newCheckToken();
    const id = await invite(circle, address(), "contributor", token);
    expect(await messagesOf(circle.circleId)).toEqual([{ payload: { invitationId: id, locale: "fr", token } }]);
    const [row] = await asService(db.service, circle.circleId, (tx) => tx.select({ hash: invitations.linkTokenHash }).from(invitations).where(eq(invitations.id, id)));
    expect(row?.hash).toBe(hashCheckToken(token));
  });

  it("opens a link that names first names and the role, and never the address", async () => {
    const circle = await realCircle("Meera Shah");
    const token = newCheckToken();
    await invite(circle, address(), "caregiver", token);
    const link = await readInvitationLink(db.app, token);
    expect(link).toEqual({ inviterFirstName: "Priya", parentFirstName: "Meera", role: "caregiver", state: "open" });
    expect(JSON.stringify(link)).not.toContain("@");
    expect(await reasonOf(readInvitationLink(db.app, newCheckToken()))).toBe("refused");
    expect(await reasonOf(readInvitationLink(db.app, "not a token"))).toBe("refused");
  });

  it("says the link is accepted once the person joined with the verified address", async () => {
    const circle = await realCircle();
    const email = address();
    const token = newCheckToken();
    await invite(circle, email, "contributor", token);
    const brother = await signedIn(db.app, "Ravi Shah", email);
    expect(await asPerson(db.app, brother, (tx) => acceptMyInvitations(tx))).toBe(1);
    expect((await readInvitationLink(db.app, token)).state).toBe("accepted");
  });

  it("refuses a second waiting invitation to the same address, and an address already in the circle", async () => {
    const circle = await realCircle();
    const email = address();
    await invite(circle, email, "contributor");
    expect(await reasonOf(invite(circle, email.toUpperCase(), "observer"))).toBe("already_invited");
    const brother = await signedIn(db.app, "Ravi Shah", email);
    await asPerson(db.app, brother, (tx) => acceptMyInvitations(tx));
    expect(await reasonOf(invite(circle, email, "observer"))).toBe("already_member");
  });

  it("lets one person send at most ten a day, across all their circles, by any path", async () => {
    const circle = await realCircle();
    for (let index = 0; index < 6; index += 1) await invite(circle, address(), "observer");
    // The same organizer's second circle shares the ten.
    const secondId = await asPerson(db.app, circle.organizer, (tx) => createCircle(tx, { name: "Dad's circle", timezone: "UTC", currency: "USD", parentName: "Arjun", parentLevel: "decides", relationship: null }));
    const seats = await asPerson(db.app, circle.organizer, (tx) => membershipsOf(tx, circle.organizer));
    const secondSeat = seats.find((each) => each.circleId === secondId);
    if (!secondSeat) throw new Error("No seat in the second circle");
    const second: RealCircle = { organizer: circle.organizer, circleId: secondId, seat: { circleId: secondId, memberId: secondSeat.memberId, role: "organizer" } };
    for (let index = 0; index < 4; index += 1) await invite(second, address(), "observer");
    expect(await reasonOf(invite(second, address(), "observer"))).toBe("too_many_by_you");
    const direct = asPerson(db.app, circle.organizer, (tx) =>
      tx.insert(invitations).values({ id: randomUUID(), circleId: circle.circleId, email: address(), role: "observer", invitedBy: circle.seat.memberId, expiresAt: new Date(Date.now() + DAY_MS) }),
    );
    expect(await errorCode(direct)).toBe("KI004");
    // Another person has their own ten.
    expect(await reasonOf(invite(await realCircle(), address(), "observer"))).toBe("no error");
  });

  it("sends at most twenty a day from one circle, whoever its organizers are", async () => {
    const circle = await realCircle();
    const coEmail = address();
    await invite(circle, coEmail, "organizer");
    const co = await signedIn(db.app, "Ravi Shah", coEmail);
    await asPerson(db.app, co, (tx) => acceptMyInvitations(tx));
    const [coSeat] = await asPerson(db.app, co, (tx) => membershipsOf(tx, co));
    if (!coSeat) throw new Error("The second organizer has no seat");
    const coCircle: RealCircle = { organizer: co, circleId: circle.circleId, seat: { circleId: circle.circleId, memberId: coSeat.memberId, role: "organizer" } };
    for (let index = 0; index < 9; index += 1) await invite(circle, address(), "observer");
    for (let index = 0; index < 10; index += 1) await invite(coCircle, address(), "observer");
    expect(await reasonOf(invite(coCircle, address(), "observer"))).toBe("too_many");
  });

  it("lets Kin as a whole send at most two hundred a day, so Gmail keeps room for sign-in codes", async () => {
    const circle = await realCircle();
    const other = await realCircle();
    // Two hundred real invitations already today, written and the check tried in one transaction that is rolled back, so no other test sees them.
    const attempt = db.admin.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`insert into invitations (id, circle_id, email, role, invited_by, expires_at)
        select gen_random_uuid(), ${circle.circleId}::uuid, 'bulk-' || n || '@example.com', 'observer', ${circle.seat.memberId}::uuid, now() + interval '1 day'
        from generate_series(1, 200) as n`);
      await tx.execute(sql`set local session_replication_role = origin`);
      await tx.execute(sql`select set_config('kin.user_id', ${other.organizer}, true)`);
      await tx.execute(sql`select kin_private.invite_member(${other.circleId}::uuid, ${address()}, 'observer'::circle_role, now() + interval '1 day', 'en', ${newCheckToken()})`);
    });
    expect(await errorCode(attempt)).toBe("KI005");
  });

  it("refuses a malformed token, language or address, and an expiry past thirty days", async () => {
    const circle = await realCircle();
    const base = { email: address(), role: "observer" as const, expiresAt: new Date(Date.now() + DAY_MS), locale: "en", token: newCheckToken() };
    for (const change of [{ token: "short" }, { locale: "xx" }, { email: "nobody" }, { expiresAt: new Date(Date.now() + 31 * DAY_MS) }, { expiresAt: new Date(Date.now() - DAY_MS) }]) {
      expect(await reasonOf(asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, circle.seat, { ...base, ...change })))).toBe("invalid");
    }
  });

  it("gives the worker what the email needs, as the service for that circle only", async () => {
    const circle = await realCircle("Meera Shah");
    const email = address();
    const id = await inviteToPlaceholder(circle, email);
    const facts = await asService(db.service, circle.circleId, (tx) => readInvitationEmailFacts(tx, circle.circleId, id));
    expect(facts).toMatchObject({ email, role: "parent", open: true, inviterName: "Priya Shah", parentName: "Meera Shah" });
    const other = await realCircle();
    expect(await asService(db.service, other.circleId, (tx) => readInvitationEmailFacts(tx, circle.circleId, id))).toBeNull();
    await asService(db.service, circle.circleId, (tx) => recordInvitationEmailed(tx, circle.circleId, id));
    const audit = await asService(db.service, circle.circleId, (tx) => tx.select({ details: auditLog.details }).from(auditLog).where(and(eq(auditLog.subjectId, id), eq(auditLog.action, "invitation.emailed"))));
    expect(audit).toEqual([{ details: {} }]);
  });

  it("is handed to the worker through the outbox", async () => {
    const circle = await realCircle();
    const id = await invite(circle, address(), "observer");
    const claimed = await claimOutbox(db.service, INVITATION_EMAIL_TOPIC, 50, 60);
    expect(claimed.some((message) => message.circleId === circle.circleId && (message.payload as { invitationId?: string }).invitationId === id)).toBe(true);
  });
});

describe("an invitation in a demo circle", () => {
  it("is recorded but never emailed, and has no link", async () => {
    const circle = await visitorWithCircle(db);
    const snapshot = await asPerson(db.app, circle.userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId: circle.userId, now: new Date() }));
    const seat: Seat = { circleId: circle.circleId, memberId: snapshot.viewer.memberId, role: snapshot.viewer.role };
    const token = newCheckToken();
    const id = await asPerson(db.app, circle.userId, (tx) => inviteMember(tx, seat, { email: address(), role: "observer", expiresAt: new Date(Date.now() + DAY_MS), locale: "en", token }));
    expect(await messagesOf(circle.circleId)).toEqual([]);
    const [row] = await asService(db.service, circle.circleId, (tx) => tx.select({ hash: invitations.linkTokenHash }).from(invitations).where(eq(invitations.id, id)));
    expect(row?.hash).toBeNull();
    expect(await reasonOf(readInvitationLink(db.app, token))).toBe("refused");
  });
});

describe("accepting a parent's invitation", () => {
  it("binds the seat the organizer chose for her, keeping the family's name and her say", async () => {
    const circle = await realCircle();
    const [placeholder] = await parentsOf(circle.circleId);
    const email = address();
    await inviteToPlaceholder(circle, email);
    const meera = await signedIn(db.app, "Meera S.", email);
    expect(await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx))).toBe(1);
    expect(await parentsOf(circle.circleId)).toEqual([{ id: placeholder?.id, userId: meera, name: "Meera", level: "informed" }]);
    expect((await asPerson(db.app, meera, (tx) => membershipsOf(tx, meera))).map((seat) => [seat.memberId, seat.role])).toEqual([[placeholder?.id, "parent"]]);
  });

  it("leaves the placeholder alone for any other role", async () => {
    const circle = await realCircle();
    const email = address();
    await invite(circle, email, "contributor");
    const ravi = await signedIn(db.app, "Ravi", email);
    await asPerson(db.app, ravi, (tx) => acceptMyInvitations(tx));
    const parents = await parentsOf(circle.circleId);
    expect(parents.map((parent) => parent.userId)).toEqual([null]);
  });

  it("binds only the inviting circle's placeholder, never another circle's", async () => {
    const [mine, theirs] = [await realCircle(), await realCircle()];
    const email = address();
    await inviteToPlaceholder(mine, email);
    const meera = await signedIn(db.app, "Meera", email);
    await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx));
    expect((await parentsOf(theirs.circleId)).map((parent) => parent.userId)).toEqual([null]);
    expect((await parentsOf(mine.circleId)).map((parent) => parent.userId)).toEqual([meera]);
  });

  it("asks the organizer to say whether a parent takes the unclaimed seat, and refuses a seat that is not one", async () => {
    const circle = await realCircle();
    expect(await reasonOf(invite(circle, address(), "parent"))).toBe("choose_seat");
    const [organizerSeat] = await asPerson(db.app, circle.organizer, (tx) => membershipsOf(tx, circle.organizer));
    // The organizer's own seat is not a parent's; a seat in another circle is not this circle's; a made-up seat is nobody's.
    for (const seat of [organizerSeat?.memberId ?? "", (await parentsOf((await realCircle()).circleId))[0]?.id ?? "", randomUUID()]) {
      expect(await reasonOf(invite(circle, address(), "parent", newCheckToken(), seat))).toBe("seat_unavailable");
    }
    // A seat is only for a parent's invitation.
    const [placeholder] = await parentsOf(circle.circleId);
    expect(await reasonOf(invite(circle, address(), "contributor", newCheckToken(), placeholder?.id ?? ""))).toBe("seat_unavailable");
  });

  it("offers a seat to one waiting invitation at a time, and never once it is claimed", async () => {
    const circle = await realCircle();
    const [first, second] = [address(), address()];
    await inviteToPlaceholder(circle, first);
    expect(await reasonOf(inviteToPlaceholder(circle, second))).toBe("seat_unavailable");
    const meera = await signedIn(db.app, "Meera", first);
    await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx));
    expect(await reasonOf(inviteToPlaceholder(circle, second))).toBe("seat_unavailable");
  });

  it("seats nobody when the named seat was claimed before they accepted, and leaves the invitation waiting", async () => {
    const circle = await realCircle();
    const [placeholder] = await parentsOf(circle.circleId);
    const email = address();
    const id = await inviteToPlaceholder(circle, email);
    const someoneElse = await signedIn(db.app, "Someone Else");
    await asService(db.service, circle.circleId, (tx) => tx.update(members).set({ userId: someoneElse }).where(eq(members.id, placeholder?.id ?? "")));
    const meera = await signedIn(db.app, "Meera", email);
    expect(await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx))).toBe(0);
    expect(await asPerson(db.app, meera, (tx) => membershipsOf(tx, meera))).toEqual([]);
    const [row] = await asService(db.service, circle.circleId, (tx) => tx.select({ status: invitations.status }).from(invitations).where(eq(invitations.id, id)));
    expect(row?.status).toBe("pending");
  });

  it("adds a new parent seat when the placeholder is already someone's", async () => {
    const circle = await realCircle();
    const [first, second] = [address(), address()];
    await inviteToPlaceholder(circle, first);
    const meera = await signedIn(db.app, "Meera", first);
    await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx));
    await invite(circle, second, "parent");
    const dad = await signedIn(db.app, "Arjun", second);
    await asPerson(db.app, dad, (tx) => acceptMyInvitations(tx));
    expect((await parentsOf(circle.circleId)).map((parent) => parent.userId).toSorted()).toEqual([meera, dad].toSorted());
  });
});
