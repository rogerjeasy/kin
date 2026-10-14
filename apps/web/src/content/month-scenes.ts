import type { Moment } from "./moment-images";

export type Scene = {
  /** The photograph beside the entry, if the moment has one. */
  moment?: Moment;
  /** Who speaks the entry's quote. */
  speaker?: "kin" | "amara";
  /** Day 1 shows the shares the family agreed. */
  showsShares?: boolean;
};

/**
 * What accompanies each day of the month on the "How it works" page, in the
 * order of the timeline entries in the dictionary. The words are translated.
 * These are not.
 */
export const monthScenes: readonly Scene[] = [
  { showsShares: true },
  { moment: "bill", speaker: "kin" },
  { moment: "caregiver", speaker: "amara" },
  { moment: "refill", speaker: "kin" },
  { moment: "letter", speaker: "kin" },
  { moment: "call", speaker: "kin" },
  {},
  { moment: "settled", speaker: "kin" },
];
