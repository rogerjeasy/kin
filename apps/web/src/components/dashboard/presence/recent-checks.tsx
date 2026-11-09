import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Locale } from "@/i18n/locales";
import type { Formatters } from "@/lib/format";
import type { CheckView } from "@/server/presence";

import { CheckActions } from "./check-actions";
import { StatePill } from "./check-result";

type Props = { checks: readonly CheckView[]; copy: Dictionary["dashboard"]["presence"]; format: Formatters; locale: Locale; approvalsHref: string };

/** The circle's recent checks, newest first, each opening to the sentence Kin said and the signs it found. */
export function RecentChecks({ checks, copy, format, locale, approvalsHref }: Props) {
  return (
    <Panel title={copy.recent.title}>
      {checks.length === 0 ? (
        <EmptyState text={copy.recent.empty} />
      ) : (
        <ul className="min-w-0 divide-y">
          {checks.map((check) => (
            <li key={check.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
              <details className="min-w-0">
                <summary className="flex min-h-11 min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 basis-48 font-medium wrap-anywhere">
                    {fill(copy.recent.row, { name: check.voiceName ?? check.claimedName ?? copy.recent.noName, amount: check.claimedCents === null ? copy.noAmount : format.money(check.claimedCents) })}
                  </span>
                  <StatePill state={check.state} copy={copy} />
                  <span className="text-sm text-muted-foreground">{format.dateTime(new Date(check.createdAt))}</span>
                  {check.simulated ? <StatusPill tone="neutral">{copy.recent.simulated}</StatusPill> : null}
                </summary>
                <div className="mt-3 min-w-0 space-y-2">
                  <p className="text-base wrap-anywhere">{check.replyText}</p>
                  <p className="text-sm text-muted-foreground">{check.markers.length === 0 ? copy.noMarkers : check.markers.map((marker) => copy.markers[marker]).join(", ")}</p>
                  {check.answeredVia === null ? null : <p className="text-sm text-muted-foreground">{copy.via[check.answeredVia]}</p>}
                  <CheckActions check={check} locale={locale} copy={copy} max={check.helpMaxCents === null ? null : format.money(check.helpMaxCents)} approvalsHref={approvalsHref} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
