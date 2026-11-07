import type { OfficeCallRecord } from "@kin/db";

import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { CallTranscript } from "./call-transcript";

type Props = {
  calls: readonly OfficeCallRecord[];
  copy: Dictionary["dashboard"]["officeLine"];
  format: Formatters;
};

/** The circle's recent calls, newest first, each opening to its written transcript. */
export function RecentCalls({ calls, copy, format }: Props) {
  return (
    <Panel title={copy.recentTitle}>
      {calls.length === 0 ? (
        <EmptyState text={copy.recentEmpty} />
      ) : (
        <ul className="min-w-0 divide-y">
          {calls.map((call) => (
            <li key={call.id} className="min-w-0 py-3 first:pt-0 last:pb-0">
              <details className="min-w-0">
                <summary className="flex min-h-11 min-w-0 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                    {fill(copy.recentRow, { organization: call.organization ?? copy.noOrganization, verdict: copy.verdicts[call.verdict] })}
                  </span>
                  <span className="text-sm text-muted-foreground">{format.day(call.calledOn)}</span>
                  {call.simulated ? <StatusPill tone="neutral">{copy.simulated}</StatusPill> : null}
                </summary>
                <div className="mt-3">
                  <CallTranscript turns={call.transcript} labels={{ kin: copy.kin, caller: copy.caller, title: copy.transcriptTitle }} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
