import { PRESENCE_ASK_TOPIC, PRESENCE_CONFIRM_TOPIC, claimOutbox, sweepPresenceChecks } from "@kin/db";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { handlePresenceAsk, handleVoiceConfirm, type PresenceTextDeps } from "./send-presence-text.ts";

const BATCH = 5;
// A text goes out in a second or two; a lease that outlives a slow Twilio answer lets no second worker text the same person.
const LEASE_SECONDS = 30;

/** Leases the checks waiting to text a person, and the confirmations, and sends each. Returns how many it leased. */
export async function runPresenceBatch(deps: PresenceTextDeps, log: InboxLog): Promise<number> {
  const asks = await claimOutbox(deps.db, PRESENCE_ASK_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of asks) await handlePresenceAsk(deps, log, message);
  const confirms = await claimOutbox(deps.db, PRESENCE_CONFIRM_TOPIC, BATCH, LEASE_SECONDS);
  for (const message of confirms) await handleVoiceConfirm(deps, log, message);
  return asks.length + confirms.length;
}

/**
 * Moves the checks whose time has run out: nobody answered within ninety
 * seconds (the family is told Kin could not reach them), or the link ran out
 * (the hold the check made is released). This needs no Twilio account, so it
 * runs even where texting is off. Returns how many it moved.
 */
export async function runPresenceSweep(db: PresenceTextDeps["db"], log: InboxLog): Promise<number> {
  const moved = await sweepPresenceChecks(db);
  if (moved > 0) log({ level: "info", message: "presence.swept", moved });
  return moved;
}
