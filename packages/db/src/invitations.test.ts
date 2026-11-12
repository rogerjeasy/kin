import { randomUUID } from "node:crypto";
import type { CircleRole } from "@kin/domain";
import { and, eq } from "drizzle-orm";
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

const invite = (circle: RealCircle, email: string, role: CircleRole, token = newCheckToken()) =>
  asPerson(db.app, circle.organizer, (tx) => inviteMember(tx, circle.seat, { email, role, expiresAt: new Date(Date.now() + 14 * DAY_MS), locale: "fr", token }));

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

  it("sends at most twenty a day from one circle, by any path", async () => {
    const circle = await realCircle();
    for (let index = 0; index < 20; index += 1) await invite(circle, address(), "observer");
    expect(await reasonOf(invite(circle, address(), "observer"))).toBe("too_many");
    const direct = asPerson(db.app, circle.organizer, (tx) =>
      tx.insert(invitations).values({ id: randomUUID(), circleId: circle.circleId, email: address(), role: "observer", invitedBy: circle.seat.memberId, expiresAt: new Date(Date.now() + DAY_MS) }),
    );
    expect(await errorCode(direct)).toBe("KI001");
    // Another circle has its own twenty.
    expect(await reasonOf(invite(await realCircle(), address(), "observer"))).toBe("no error");
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
    const id = await invite(circle, email, "parent");
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
  it("binds the seat the organizer made for her, keeping the family's name and her say", async () => {
    const circle = await realCircle();
    const [placeholder] = await parentsOf(circle.circleId);
    const email = address();
    await invite(circle, email, "parent");
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
    await invite(mine, email, "parent");
    const meera = await signedIn(db.app, "Meera", email);
    await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx));
    expect((await parentsOf(theirs.circleId)).map((parent) => parent.userId)).toEqual([null]);
    expect((await parentsOf(mine.circleId)).map((parent) => parent.userId)).toEqual([meera]);
  });

  it("adds a new parent seat when the placeholder is already someone's", async () => {
    const circle = await realCircle();
    const [first, second] = [address(), address()];
    await invite(circle, first, "parent");
    const meera = await signedIn(db.app, "Meera", first);
    await asPerson(db.app, meera, (tx) => acceptMyInvitations(tx));
    await invite(circle, second, "parent");
    const dad = await signedIn(db.app, "Arjun", second);
    await asPerson(db.app, dad, (tx) => acceptMyInvitations(tx));
    expect((await parentsOf(circle.circleId)).map((parent) => parent.userId).toSorted()).toEqual([meera, dad].toSorted());
  });
});
