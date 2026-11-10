import type { PurseTerms } from "@kin/domain";

import type { PursePayeeKind } from "../purse.ts";
import type { PersonaKey } from "./roses-circle.ts";

/**
 * Rose's Purse in the demo: fifty dollars a week, never more than a hundred in
 * it, and forty dollars the most one payment may be without a cooling-off. The
 * family set it up together on Monday; this week's float has already moved, so
 * the Purse holds fifty dollars the moment a visitor opens the demo. Every
 * figure is simulated and labelled so.
 */
export const PURSE_TERMS: PurseTerms = { weeklyCents: 5_000, ceilingCents: 10_000, perPaymentCents: 4_000 };

/** Elena, the organizer, set the Purse up; the template's Monday of Rose's last week. */
export const PURSE_SET = { by: "elena", at: new Date("2026-10-26T14:00:00Z") } as const satisfies { by: PersonaKey; at: Date };

/** The ledger entries the Purse adds beside Rose's month: this week's float. */
export const PURSE_SEED_ENTRIES = 1;

/** This week's float, moved from the pool into the Purse that morning. */
export const PURSE_FUNDED_AT = new Date("2026-10-30T13:00:00Z");

export type DemoPursePayee = {
  readonly key: string;
  readonly name: string;
  readonly relationship: string;
  readonly kind: PursePayeeKind;
  readonly aliases: readonly string[];
  /** Never a real address: a reserved example domain, so nobody real is ever paid. */
  readonly paypalReceiver: string;
  readonly addedBy: PersonaKey;
  /** `null` for an entry still waiting for a family member to verify it. */
  readonly verifiedBy: PersonaKey | null;
  readonly at: Date;
};

/**
 * Rose's address book. Lily, her granddaughter, and her church were verified
 * by the family once; Sam, who delivers her paper, she added herself and is
 * still waiting for someone to verify, so the demo can show that step.
 */
export const PURSE_PAYEES: readonly DemoPursePayee[] = [
  { key: "lily", name: "Lily", relationship: "granddaughter", kind: "person", aliases: ["Lil", "ليلي", "לילי"], paypalReceiver: "lily@personal.example.com", addedBy: "rose", verifiedBy: "elena", at: new Date("2026-10-26T15:00:00Z") },
  { key: "church", name: "St. Mary's Church", relationship: "her church", kind: "charity", aliases: ["St Mary's", "Saint Mary's"], paypalReceiver: "giving@stmarys.example.org", addedBy: "elena", verifiedBy: "ana", at: new Date("2026-10-26T15:05:00Z") },
  { key: "sam", name: "Sam", relationship: "delivers her newspaper", kind: "person", aliases: [], paypalReceiver: "sam@personal.example.com", addedBy: "rose", verifiedBy: null, at: new Date("2026-10-29T16:00:00Z") },
];
