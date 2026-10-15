import type { GivenRow } from "@/components/dashboard/ui/given-bars";
import type { MemberFairness } from "@/content/circle/fairness";
import type { CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type PositionWords = { owed: string; owes: string; level: string };

/** A sharing member's position as a status: owed, owes or level, in the words given. */
export function positionStatus(format: Formatters, positionCents: number, words: PositionWords, name = ""): GivenRow["position"] {
  if (positionCents > 0) return { tone: "positive", text: fill(words.owed, { name, amount: format.money(positionCents) }) };
  if (positionCents < 0) return { tone: "waiting", text: fill(words.owes, { name, amount: format.money(-positionCents) }) };
  return { tone: "neutral", text: fill(words.level, { name }) };
}

/** The bars for each sharing member: what they gave against their agreed share. */
export function givenRows(
  dictionary: Dictionary,
  names: CircleNames,
  format: Formatters,
  members: readonly MemberFairness[],
  portraitOf: (memberId: string) => string | null,
): GivenRow[] {
  const { given, target } = dictionary.dashboard.fairness.members;
  return members.map(({ memberId, shareBps, shareIndex, position }) => {
    const name = names.member(memberId);
    const detail = `${given} ${format.money(position.contributedCents)} · ${target} ${format.money(position.targetCents)}`;
    return {
      memberId,
      name,
      portrait: portraitOf(memberId),
      shareIndex,
      share: format.share(shareBps),
      givenCents: position.contributedCents,
      targetCents: position.targetCents,
      detail,
      label: `${name}: ${detail}`,
      position: positionStatus(format, position.positionCents, dictionary.dashboard.overview.fairness),
    };
  });
}
