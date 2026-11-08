import type { CircleSnapshot } from "@kin/db";

import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import type { CircleNames } from "@/content/circle/names";
import type { Need } from "@/content/circle/shift-views";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { Formatters } from "@/lib/format";
import { firstNameOf, wordedQuestion, wordingDeps, worthABadge } from "@/server/shift-wording";
import type { Viewer } from "@/server/viewer";

import type { NeedItem } from "./need-card";

export type WordingScope = {
  readonly circle: CircleSnapshot;
  readonly locale: Locale;
  readonly dictionary: Dictionary;
  readonly viewer: Viewer;
  readonly names: CircleNames;
  readonly format: Formatters;
};

/**
 * The cards the viewer is asked to answer, with the family's question worded
 * by Claude where it can be and Kin's fixed wording where it cannot. The
 * facts come from the record, the model never sees a name, and the card says
 * which of the two made the sentence.
 */
export async function wordNeedItems(items: readonly NeedItem[], needs: readonly Need[], scope: WordingScope): Promise<NeedItem[]> {
  const { locale, dictionary, viewer, names, format } = scope;
  const deps = wordingDeps();
  const who = { userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? ("demo" as const) : viewer.session.accountTypes };
  return Promise.all(
    items.map(async (item) => {
      const need = needs.find((each) => each.shift.id === item.shiftId && each.kind === item.kind);
      if (need === undefined || need.kind !== "word") return item;
      const { shift } = need;
      const wording = await wordedQuestion(deps, who, shift.id, {
        language: locale,
        caregiver: firstNameOf(names.member(shift.memberId)),
        part: need.part,
        checkedOutAt: shift.checkedOutAt === null ? null : format.time(shift.checkedOutAt),
        title: shift.title,
      });
      return { ...item, headline: wording.text, badge: worthABadge(wording) ? <ProvenanceBadge provenance={wording.provenance} kind="worded" copy={dictionary.aiProvenance} /> : undefined };
    }),
  );
}
