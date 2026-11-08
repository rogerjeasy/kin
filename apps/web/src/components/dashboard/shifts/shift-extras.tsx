import Link from "next/link";

import { ShiftCallButton } from "@/components/dashboard/shift-calls/shift-call-button";
import { ShiftLinkPanel } from "@/components/dashboard/shift-links/shift-link-panel";
import type { CircleNames } from "@/content/circle/names";
import type { ShiftView } from "@/content/circle/shift-views";
import { durationText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

/** What the new facts and actions on a shift card need that every card shares, worded and decided once by the page. */
export type ShiftExtrasScope = {
  readonly locale: Locale;
  readonly timezone: string;
  /** The viewer, so a credited visit says whether the credit is theirs. */
  readonly viewerMemberId: string;
  /** Whether this deployment can text a link. */
  readonly textingOn: boolean;
  /** Where the fairness page is, or `null` for a viewer who may not see the family's money. */
  readonly fairnessHref: string | null;
  readonly links: Dictionary["dashboard"]["shiftLinks"];
  readonly calls: Dictionary["dashboard"]["shiftCalls"];
};

type Props = { view: ShiftView; scope: ShiftExtrasScope; copy: ShiftCopy; format: Formatters; names: CircleNames };

/**
 * Below a shift's keys: what a finished visit counted for, how Kin's call
 * about it went, and the two things a person can do with it, make a check-in
 * link and (in the demo) hear Kin's call. Each shows only when the record has
 * something to say or the viewer may act.
 */
export function ShiftExtras({ view, scope, copy, format, names }: Props) {
  const { shift } = view;
  const { calls, links } = scope;
  const credited = shift.creditedMinutes !== null && shift.creditedCents !== null;
  const mine = shift.memberId === scope.viewerMemberId;
  const creditWords = credited
    ? fill(mine ? calls.credit : calls.creditFor, { duration: durationText(copy, format, shift.creditedMinutes ?? 0), amount: format.money(shift.creditedCents ?? 0), name: names.member(shift.memberId) })
    : null;
  const callWords = shift.callState === null ? null : fill(calls.states[shift.callState], { parent: names.parent });
  if (creditWords === null && callWords === null && !view.canLink && !view.canHearCall) return null;

  return (
    <div className="min-w-0 space-y-3">
      {creditWords !== null ? (
        <p className="text-sm text-pretty">
          {creditWords}
          {scope.fairnessHref !== null ? (
            <>
              {" "}
              <Link href={scope.fairnessHref} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                {calls.creditLink}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {callWords !== null ? <p className="text-sm text-muted-foreground text-pretty">{callWords}</p> : null}
      {view.canLink || view.canHearCall ? (
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          {view.canLink ? <ShiftLinkPanel shiftId={shift.id} name={names.member(shift.memberId)} locale={scope.locale} timezone={scope.timezone} copy={links} shifts={copy} textingOn={scope.textingOn} /> : null}
          {view.canHearCall ? <ShiftCallButton shiftId={shift.id} locale={scope.locale} parent={names.parent} copy={calls.simulator} shifts={copy} /> : null}
        </div>
      ) : null}
    </div>
  );
}
