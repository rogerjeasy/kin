import type { GivenRow } from "@/components/dashboard/ui/given-bars";
import type { MemberFairness } from "@/content/demo-circle/fairness";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { nameOf } from "./names";

type PositionWords = { owed: string; owes: string; level: string };

/** A sibling's position as a status: owed, owes or level, in the words given. */
export function positionStatus(format: Formatters, positionCents: number, words: PositionWords, name = ""): GivenRow["position"] {
  if (positionCents > 0) return { tone: "positive", text: fill(words.owed, { name, amount: format.money(positionCents) }) };
  if (positionCents < 0) return { tone: "waiting", text: fill(words.owes, { name, amount: format.money(-positionCents) }) };
  return { tone: "neutral", text: fill(words.level, { name }) };
}

/** The bars for each sibling: what they gave against their agreed share. */
export function givenRows(dictionary: Dictionary, format: Formatters, members: readonly MemberFairness[]): GivenRow[] {
  const { given, target } = dictionary.dashboard.fairness.members;
  return members.map(({ memberId, shareBps, position }) => {
    const name = nameOf(dictionary, memberId);
    const detail = `${given} ${format.money(position.contributedCents)} · ${target} ${format.money(position.targetCents)}`;
    return {
      memberId,
      name,
      share: format.share(shareBps),
      givenCents: position.contributedCents,
      targetCents: position.targetCents,
      detail,
      label: `${name}: ${detail}`,
      position: positionStatus(format, position.positionCents, dictionary.dashboard.overview.fairness),
    };
  });
}
