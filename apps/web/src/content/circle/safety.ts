import { entryHeadline } from "@kin/domain";
import type { CircleSnapshot, ClaimCheckRecord } from "@kin/db";

import { entryById } from "./record";
import { parentOf } from "./members";

export type ClaimCheckView = ClaimCheckRecord & {
  /** The last real payment the record holds to that payee, the fact checked against. */
  readonly lastPaid: { readonly cents: number; readonly day: string } | null;
};

/** The most recent demand Kin checked against the record. */
export function latestClaimCheck(circle: CircleSnapshot): ClaimCheckView | null {
  const [latest] = circle.claimChecks;
  if (!latest) return null;
  const entry = entryById(circle, latest.foundEntryId);
  return { ...latest, lastPaid: entry ? { cents: entryHeadline(entry).cents, day: entry.occurredOn } : null };
}

export const NARRATION_TOPICS = ["billPaid", "refill", "letter", "falseDemand", "caregiverPaid"] as const;

export type NarrationTopic = (typeof NARRATION_TOPICS)[number];

export type Narration = {
  readonly id: string;
  readonly topic: NarrationTopic;
  /** YYYY-MM-DD. */
  readonly day: string;
  /** Who or what the news was about: the subject of the entry behind it. */
  readonly subject: string;
  /** The amount the parent heard, read from the ledger entry behind it. */
  readonly cents: number;
};

const isTopic = (topic: string): topic is NarrationTopic => (NARRATION_TOPICS as readonly string[]).includes(topic);

/**
 * What Kin told the parent, newest first. Each amount is checked against the
 * entry it came from, as the number guard requires; one that disagrees, or
 * whose entry the person cannot see, is not shown.
 */
export function parentHeard(circle: CircleSnapshot): Narration[] {
  const parent = parentOf(circle);
  if (!parent) return [];
  return circle.narrations.flatMap((narration) => {
    if (narration.memberId !== parent.id || narration.state !== "delivered" || !isTopic(narration.topic)) return [];
    const entry = entryById(circle, narration.entryId);
    if (!entry || narration.cents === null) return [];
    const headline = entryHeadline(entry);
    if (headline.cents !== narration.cents) return [];
    return [{ id: narration.id, topic: narration.topic, day: narration.saidOn, subject: headline.subject, cents: narration.cents }];
  });
}
