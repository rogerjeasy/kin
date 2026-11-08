import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import { coverNeeds, type CoverNeed } from "@/content/circle/shift-cover";
import { durationText } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";
import { firstNameOf, wordedCoverNote, wordingDeps, worthABadge } from "@/server/shift-wording";

import { CoverCards } from "./cover-cards";
import type { CoverItem } from "./cover-card";
import type { WordingScope } from "./worded-needs";

async function coverItem(need: CoverNeed, scope: WordingScope): Promise<CoverItem> {
  const { circle, locale, dictionary, viewer, names, format } = scope;
  const { shift, candidates, window } = need;
  const copy = dictionary.dashboard.shifts;
  const cover = dictionary.dashboard.shiftCover;
  const when = fill(copy.when, { day: format.weekdayDay(shift.startsAt), start: format.time(shift.startsAt), end: format.time(shift.endsAt) });
  const hours = (minutes: number) => durationText(copy, format, minutes);
  const people = candidates.map((candidate) => {
    const name = names.member(candidate.memberId);
    return {
      memberId: candidate.memberId,
      name,
      kind: candidate.kind,
      kindText: candidate.kind === "aide" ? cover.aide : cover.visit,
      hoursDay: fill(cover.hoursDay, { hours: hours(candidate.minutesThatDay) }),
      hoursWeek: fill(cover.hoursWeek, { hours: hours(candidate.minutesThisWeek) }),
      button: fill(cover.ask, { name }),
    };
  });
  const who = { userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? ("demo" as const) : viewer.session.accountTypes };
  const wording = await wordedCoverNote(wordingDeps(), who, shift.id, {
    language: locale,
    when,
    title: shift.title,
    candidates: candidates.map((candidate) => ({
      name: firstNameOf(names.member(candidate.memberId)),
      kind: candidate.kind,
      hoursThatDay: hours(candidate.minutesThatDay),
      hoursThisWeek: hours(candidate.minutesThisWeek),
    })),
  });
  return {
    shiftId: shift.id,
    heading: fill(cover.lede, { name: names.member(shift.memberId), when }),
    title: shift.title,
    note: wording === null ? null : { text: wording.text, badge: worthABadge(wording) ? <ProvenanceBadge provenance={wording.provenance} kind="worded" copy={dictionary.aiProvenance} /> : null },
    people,
    window,
    timezone: circle.circle.timezone,
  };
}

/**
 * The aide shifts that were called off and still lie ahead, each with the
 * people who could take it, ranked by plain code, and a note on why, worded
 * by Claude or fixed. Nothing here books anyone: each person's button is a
 * human's choice, and the server checks it as it checks any scheduling.
 */
export async function CoverSection({ scope }: { scope: WordingScope }) {
  const needs = coverNeeds(scope.circle);
  if (needs.length === 0) return null;
  const items = await Promise.all(needs.map((need) => coverItem(need, scope)));
  return <CoverCards items={items} copy={scope.dictionary.dashboard.shifts} cover={scope.dictionary.dashboard.shiftCover} />;
}
