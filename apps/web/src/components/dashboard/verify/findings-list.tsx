import type { Provenance } from "@kin/agent/provenance";
import { AlertTriangleIcon, EyeIcon, InfoIcon } from "lucide-react";

import { ProvenanceBadge } from "@/components/dashboard/ai/provenance-badge";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";

type Severity = "info" | "attention" | "critical";

export type FindingRow = { id: string; severity: Severity; text: string; provenance: Provenance; about: string | null };

const PRESENTATION = {
  info: { tone: "neutral", icon: InfoIcon },
  attention: { tone: "waiting", icon: EyeIcon },
  critical: { tone: "danger", icon: AlertTriangleIcon },
} as const satisfies Record<Severity, { tone: PillTone; icon: typeof InfoIcon }>;

type FindingsListProps = { copy: Dictionary["dashboard"]["verify"]["auditor"]; ai: Dictionary["aiProvenance"]; rows: readonly FindingRow[] };

/** What the auditor found, most serious first, each with the entry it is about and who worded it. */
export function FindingsList({ copy, ai, rows }: FindingsListProps) {
  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const { tone, icon } = PRESENTATION[row.severity];
        return (
          <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={tone} icon={icon}>
                {copy.severity[row.severity]}
              </StatusPill>
              <ProvenanceBadge provenance={row.provenance} kind="worded" copy={ai} />
            </div>
            <p className="text-pretty">{row.text}</p>
            {row.about === null ? null : (
              <p className="text-sm break-words text-muted-foreground">
                {copy.about}: {row.about}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
