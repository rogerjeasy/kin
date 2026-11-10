import type { OfficeCallRecord } from "@kin/db";
import { ChevronDownIcon, PhoneIncomingIcon } from "lucide-react";

import { shownVerdict } from "@/components/dashboard/letters/verdict-pill";
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
        <ul className="enter-stagger min-w-0 space-y-2">
          {calls.map((call) => (
            <li key={call.id} className="min-w-0">
              <details className="group min-w-0 rounded-2xl border bg-background/60 transition-colors open:bg-muted/60">
                <summary className="flex min-h-14 min-w-0 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-3 py-2 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground ring-1 ring-border">
                    <PhoneIncomingIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                    {fill(copy.recentRow, { organization: call.organization ?? copy.noOrganization, verdict: copy.verdicts[shownVerdict(call.verdict, call.payeeId)] })}
                  </span>
                  <span className="text-sm text-muted-foreground">{format.day(call.calledOn)}</span>
                  {call.simulated ? <StatusPill tone="neutral">{copy.simulated}</StatusPill> : null}
                  <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" />
                </summary>
                <div className="px-3 pt-1 pb-4">
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
