import { CheckIcon, OctagonXIcon, MinusIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

export type CallView = { readonly id: string; readonly tool: string; readonly outcome: keyof Dictionary["openKin"]["list"]["outcomes"]; readonly at: string; readonly proposed: boolean };

type Props = { calls: readonly CallView[]; copy: Dictionary["openKin"]["list"]; toolLabels: Readonly<Record<string, string>> };

const REFUSED = new Set(["unknown_tool", "refused", "invalid"]);

/** Each call an assistant made: when, which tool in plain words, and what Kin did with it. A refused approve stands out. */
export function CallList({ calls, copy, toolLabels }: Props) {
  if (calls.length === 0) return <p className="text-sm text-muted-foreground">{copy.noCalls}</p>;
  return (
    <ol className="grid min-w-0 divide-y">
      {calls.map((call) => {
        const refused = REFUSED.has(call.outcome);
        return (
          <li key={call.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <time className="w-full shrink-0 text-xs text-muted-foreground tabular-nums sm:w-28">{call.at}</time>
            <span className="min-w-0 flex-1 basis-40 text-sm wrap-anywhere">
              {toolLabels[call.tool] ?? fill(copy.asked, { tool: call.tool })}
              {call.proposed ? <span className="block text-xs text-muted-foreground">{copy.proposed}</span> : null}
            </span>
            <StatusPill tone={call.outcome === "ok" ? "positive" : refused ? "danger" : "neutral"} icon={call.outcome === "ok" ? CheckIcon : refused ? OctagonXIcon : MinusIcon}>
              {copy.outcomes[call.outcome]}
            </StatusPill>
          </li>
        );
      })}
    </ol>
  );
}
