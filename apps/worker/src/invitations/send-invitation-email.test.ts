import { INVITATION_EMAIL_TOPIC, asPerson, claimOutbox, createCircle, inviteMember, membershipsOf, newCheckToken, recordSignIn } from "@kin/db";
import { adminRun, serviceRows, testDatabases } from "@kin/db/testing";
import { EmailDeliveryError, type EmailMessage, type EmailSender } from "@kin/notify";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { runInvitationBatch } from "./send-invitation-email.ts";

const db = testDatabases();
const WEB = "https://kin.example.com";
const DAY_MS = 86_400_000;

type Sent = EmailMessage & { readonly to: string };
function fakeEmail(failure: EmailDeliveryError | null = null): EmailSender & { readonly sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(message) {
      if (failure) throw failure;
      sent.push(message);
    },
  };
}

function recordingLog(): { readonly lines: Record<string, unknown>[]; readonly log: InboxLog } {
  const lines: Record<string, unknown>[] = [];
  return { lines, log: (line) => lines.push(line) };
}

/** A real circle with its organizer and one invitation waiting to be emailed. */
async function invited(email: string, token = newCheckToken()) {
  const organizer = randomUUID();
  await asPerson(db.app, organizer, (tx) => recordSignIn(tx, { id: organizer, email: `${organizer}@example.com`, emailVerified: true, name: "Priya Shah" }));
  const circleId = await asPerson(db.app, organizer, (tx) => createCircle(tx, { name: "Mum's circle", timezone: "UTC", currency: "USD", parentName: "Meera", parentLevel: "decides", relationship: null }));
  const [seat] = await asPerson(db.app, organizer, (tx) => membershipsOf(tx, organizer));
  if (!seat) throw new Error("The organizer has no seat");
  const invitationId = await asPerson(db.app, organizer, (tx) =>
    inviteMember(tx, { circleId, memberId: seat.memberId, role: "organizer" }, { email, role: "caregiver", expiresAt: new Date(Date.now() + 14 * DAY_MS), locale: "fr", token }),
  );
  return { circleId, invitationId, token };
}

/** Leaves the queue the way a fresh database has it: other tests' invitations are not this test's to send. */
const drain = async () => {
  await claimOutbox(db.service, INVITATION_EMAIL_TOPIC, 100, 10);
  await adminRun(db, "update outbox set sent_at = now() where topic = 'invitation.email' and sent_at is null");
};

const queued = (circleId: string) => serviceRows(db, circleId, "select payload ? 'token' as has, sent_at is not null as sent, attempts from outbox where topic = 'invitation.email'");

describe("emailing an invitation", () => {
  it("sends one email in the inviter's language with the link, writes it down, and forgets the link in the queue", async () => {
    await drain();
    const email = `ravi-${randomUUID()}@example.com`;
    const { circleId, invitationId, token } = await invited(email);
    const sender = fakeEmail();
    const { lines, log } = recordingLog();
    expect(await runInvitationBatch({ db: db.service, email: sender, webUrl: WEB }, log)).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe(email);
    expect(sender.sent[0]?.subject).toBe("Priya Shah vous invite dans le cercle de Meera sur Kin");
    expect(sender.sent[0]?.text.split("\n")).toContain(`${WEB}/fr/join/${token}`);
    expect(await queued(circleId)).toEqual([{ has: false, sent: true, attempts: 1 }]);
    expect(await serviceRows(db, circleId, "select count(*)::int as n from audit_log where action = 'invitation.emailed' and subject_id = $1", [invitationId])).toEqual([{ n: 1 }]);
    // The log names the circle and a masked address, never the address or the token.
    expect(JSON.stringify(lines)).not.toContain(email);
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(await runInvitationBatch({ db: db.service, email: sender, webUrl: WEB }, log)).toBe(0);
  });

  it("drops an invitation that was accepted or ran out before the email went", async () => {
    await drain();
    const { circleId, invitationId } = await invited(`late-${randomUUID()}@example.com`);
    await adminRun(db, "update invitations set status = 'expired' where id = $1", [invitationId]);
    const sender = fakeEmail();
    expect(await runInvitationBatch({ db: db.service, email: sender, webUrl: WEB }, () => {})).toBe(1);
    expect(sender.sent).toEqual([]);
    expect(await queued(circleId)).toEqual([{ has: false, sent: true, attempts: 1 }]);
  });

  it("tries again later when Gmail could not take it, and lets go of one Gmail refused for good", async () => {
    await drain();
    const first = await invited(`retry-${randomUUID()}@example.com`);
    await runInvitationBatch({ db: db.service, email: fakeEmail(new EmailDeliveryError("busy", true)), webUrl: WEB }, () => {});
    expect(await queued(first.circleId)).toEqual([{ has: true, sent: false, attempts: 1 }]);

    await drain();
    const second = await invited(`refused-${randomUUID()}@example.com`);
    await runInvitationBatch({ db: db.service, email: fakeEmail(new EmailDeliveryError("refused", false)), webUrl: WEB }, () => {});
    expect(await queued(second.circleId)).toEqual([{ has: false, sent: true, attempts: 1 }]);
  });
});
