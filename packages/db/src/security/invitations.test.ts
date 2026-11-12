import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { newCheckToken } from "../check-links.ts";
import { inviteMember } from "../invitations.ts";
import { createCircle, membershipsOf } from "../people.ts";
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
