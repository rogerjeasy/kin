import {
  asService,
  finishMessage,
  readPresenceAskFacts,
  readVoiceConfirmFacts,
  recordPresenceAsked,
  recordVoiceConfirmSent,
  retryMessageLater,
  stripOutboxToken,
  type ClaimedMessage,
  type Database,
} from "@kin/db";
import { presenceIsOpen } from "@kin/domain";
import { TextDeliveryError, type TextSender } from "@kin/notify";
import { isOfficeLocale, presenceAskText, voiceConfirmText, type OfficeLocale } from "@kin/telephony";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";

export type PresenceTextDeps = {
  /** Connected as `kin_service`. Every transaction names the one circle it acts for. */
  readonly db: Database;
  readonly texts: TextSender;
  /** The web app's https address with no trailing slash, where the text's link leads. */
  readonly webUrl: string;
};

/** A text that fails for a reason a second try can mend is tried again this soon, and no more than this often: the answer is wanted within ninety seconds. */
const RETRY_SECONDS = 5;
const MAX_TRIES = 3;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const localeOf = (value: string): OfficeLocale => (isOfficeLocale(value) ? value : "en");

/** The link a person taps: the web app's own page for a check or a confirmation, in their language. The token is the credential. */
const link = (webUrl: string, locale: OfficeLocale, kind: "v" | "t", token: string): string => `${webUrl}/${locale}/${kind}/${token}`;

/**
 * What to do about a text that failed. A text Twilio may have accepted is never
 * sent twice (the person would get two): it is finished, and the check simply
 * ends "could not be reached" if no answer comes. One that Twilio refused for a
 * reason a retry can mend is tried again, a few times, and then let go.
 */
async function afterFailure(deps: PresenceTextDeps, log: InboxLog, message: ClaimedMessage, error: unknown, event: string): Promise<void> {
  const delivery = error instanceof TextDeliveryError ? error : null;
  const again = delivery !== null && delivery.retryable && !delivery.mayHaveBeenSent && message.attempts < MAX_TRIES;
  log({ level: "error", message: event, circleId: message.circleId, reason: delivery?.reason ?? errorName(error), retrying: again });
  await asService(deps.db, message.circleId, async (tx) => {
    if (again) {
      await retryMessageLater(tx, message.id, RETRY_SECONDS);
      return;
    }
    await stripOutboxToken(tx, message.id);
    await finishMessage(tx, message.id);
  });
}

/** Texts the real person "is this you?" for one `presence.ask` message, once. */
export async function handlePresenceAsk(deps: PresenceTextDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const { circleId } = message;
  const payload = isObject(message.payload) ? message.payload : null;
  const checkId = typeof payload?.["checkId"] === "string" && UUID.test(payload["checkId"]) ? payload["checkId"] : null;
  const token = typeof payload?.["token"] === "string" && TOKEN.test(payload["token"]) ? payload["token"] : null;
  const facts = checkId === null ? null : await asService(deps.db, circleId, (tx) => readPresenceAskFacts(tx, circleId, checkId));
  // A check that is gone, closed or past its link is not texted: asking someone "is this you?" about an old call only frightens them.
  const live = facts !== null && token !== null && (presenceIsOpen(facts.state) || facts.state === "unanswered") && facts.expiresAt.getTime() > Date.now();
  if (checkId === null || facts === null || token === null || !live) {
    log({ level: "info", message: "presence.ask_dropped", circleId });
    await asService(deps.db, circleId, async (tx) => {
      await stripOutboxToken(tx, message.id);
      await finishMessage(tx, message.id);
    });
    return;
  }
  const locale = localeOf(facts.locale);
  let body: string;
  try {
    body = presenceAskText({ locale, currency: facts.currency, name: facts.voiceName, parentName: facts.parentName, claimedCents: facts.claimedCents, link: link(deps.webUrl, locale, "v", token) });
  } catch (error) {
    await afterFailure(deps, log, message, error, "presence.ask_unwordable");
    return;
  }
  try {
    const sent = await deps.texts.send({ to: facts.phone, body });
    await asService(deps.db, circleId, async (tx) => {
      await recordPresenceAsked(tx, circleId, checkId, sent.messageSid);
      await finishMessage(tx, message.id);
    });
    log({ level: "info", message: "presence.asked", circleId, checkId });
  } catch (error) {
    await afterFailure(deps, log, message, error, "presence.ask_failed");
  }
}

/** Texts a family member the link that confirms their number, for one `presence.confirm` message, once. */
export async function handleVoiceConfirm(deps: PresenceTextDeps, log: InboxLog, message: ClaimedMessage): Promise<void> {
  const { circleId } = message;
  const payload = isObject(message.payload) ? message.payload : null;
  const voiceId = typeof payload?.["voiceId"] === "string" && UUID.test(payload["voiceId"]) ? payload["voiceId"] : null;
  const token = typeof payload?.["token"] === "string" && TOKEN.test(payload["token"]) ? payload["token"] : null;
  const facts = voiceId === null ? null : await asService(deps.db, circleId, (tx) => readVoiceConfirmFacts(tx, circleId, voiceId));
  if (voiceId === null || facts === null || token === null || facts.confirmed) {
    await asService(deps.db, circleId, async (tx) => {
      await stripOutboxToken(tx, message.id);
      await finishMessage(tx, message.id);
    });
    return;
  }
  const locale = localeOf(facts.locale);
  try {
    await deps.texts.send({ to: facts.phone, body: voiceConfirmText({ locale, parentName: facts.parentName, link: link(deps.webUrl, locale, "t", token) }) });
    await asService(deps.db, circleId, async (tx) => {
      await recordVoiceConfirmSent(tx, circleId, voiceId);
      await finishMessage(tx, message.id);
    });
    log({ level: "info", message: "presence.confirm_sent", circleId });
  } catch (error) {
    await afterFailure(deps, log, message, error, "presence.confirm_failed");
  }
}
