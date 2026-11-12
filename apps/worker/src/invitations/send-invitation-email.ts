import {
  INVITATION_EMAIL_TOPIC,
  asService,
  claimOutbox,
  finishMessage,
  readInvitationEmailFacts,
  recordInvitationEmailed,
  retryMessageLater,
  stripOutboxToken,
  type ClaimedMessage,
  type Database,
} from "@kin/db";
import { EmailDeliveryError, invitationEmail, isInvitationRole, isTextLocale, type EmailMessage, type EmailSender } from "@kin/notify";

import { maskEmail } from "../cognito-email-sender/event.ts";
import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

export type InvitationEmailDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly email: EmailSender;
  /** The web app's https address with no trailing slash, where the email's link leads. */
  readonly webUrl: string;
};

const BATCH = 5;
// An email goes out in a few seconds; a lease longer than Gmail's slowest answer lets no second worker send it again.
const LEASE_SECONDS = 60;
/** Gmail that could not take the email is asked again this much later, a few times, and then let go. */
const RETRY_SECONDS = 120;
const MAX_TRIES = 4;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Done with the message: the outbox forgets the link, sent or not, so no row keeps a token. */
async function letGo(deps: InvitationEmailDeps, message: ClaimedMessage): Promise<void> {
  await asService(deps.db, message.circleId, async (tx) => {
    await stripOutboxToken(tx, message.id);
    await finishMessage(tx, message.id);
  });
}

/** Emails one invitation, once. An invitation that is no longer waiting is dropped, not emailed. */
export async function handleInvitationEmail(deps: InvitationEmailDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const { circleId } = message;
  const payload = isObject(message.payload) ? message.payload : null;
  const invitationId = typeof payload?.["invitationId"] === "string" && UUID.test(payload["invitationId"]) ? payload["invitationId"] : null;
  const token = typeof payload?.["token"] === "string" && TOKEN.test(payload["token"]) ? payload["token"] : null;
  const locale = typeof payload?.["locale"] === "string" && isTextLocale(payload["locale"]) ? payload["locale"] : "en";
  const facts = invitationId === null ? null : await asService(deps.db, circleId, (tx) => readInvitationEmailFacts(tx, circleId, invitationId));
  if (invitationId === null || token === null || facts === null || !facts.open || !isInvitationRole(facts.role)) {
    log({ level: "info", message: "invitation.email_dropped", circleId });
    await letGo(deps, message);
    return;
  }
  let email: EmailMessage;
  try {
    email = invitationEmail({ locale, inviterName: facts.inviterName, parentName: facts.parentName, role: facts.role, expiresAt: facts.expiresAt, link: `${deps.webUrl}/${locale}/join/${token}` });
  } catch (error) {
    log({ level: "error", message: "invitation.email_unwordable", circleId, reason: errorName(error) });
    await letGo(deps, message);
    return;
  }
  try {
    await deps.email.send({ to: facts.email, ...email });
  } catch (error) {
    const again = error instanceof EmailDeliveryError && error.retryable && message.attempts < MAX_TRIES;
    log({ level: "error", message: "invitation.email_failed", circleId, to: maskEmail(facts.email), reason: errorName(error), retrying: again });
    if (again) await asService(deps.db, circleId, (tx) => retryMessageLater(tx, message.id, RETRY_SECONDS));
    else await letGo(deps, message);
    return;
  }
  await asService(deps.db, circleId, async (tx) => {
    await recordInvitationEmailed(tx, circleId, invitationId);
    await stripOutboxToken(tx, message.id);
    await finishMessage(tx, message.id);
  });
  log({ level: "info", message: "invitation.emailed", circleId, to: maskEmail(facts.email) });
}

/** Leases the invitations waiting to be emailed and sends each. Returns how many it leased. */
export async function runInvitationBatch(deps: InvitationEmailDeps, log: InboxLog): Promise<number> {
  const messages = await claimOutbox(deps.db, INVITATION_EMAIL_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of messages) await handleInvitationEmail(deps, log, message);
  return messages.length;
}
