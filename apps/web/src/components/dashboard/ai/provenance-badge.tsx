import type { Provenance } from "@kin/agent/provenance";
import { ScrollTextIcon, SparklesIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = {
  provenance: Provenance;
  /** What Claude did when it made the result: read a document, or put a finding into words. */
  kind: "read" | "worded";
  copy: Dictionary["aiProvenance"];
};

/**
 * Says who produced a result: Claude, with the model's own ID, or Kin's fixed
 * rules or wording, with the reason Claude was not used. Honest in both
 * directions, and the words carry the meaning, not the colour.
 */
export function ProvenanceBadge({ provenance, kind, copy }: Props) {
  const claude = provenance.source === "claude";
  const label = claude ? (kind === "read" ? copy.badge.claudeRead : copy.badge.claudeWorded) : copy.badge[provenance.source];
  const detail = claude ? (provenance.model === null ? null : fill(copy.model, { model: provenance.model })) : copy.reasons[provenance.reason];
  return (
    <span title={detail ?? undefined} className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <StatusPill tone={claude ? "positive" : "neutral"} icon={claude ? SparklesIcon : ScrollTextIcon}>
        {label}
      </StatusPill>
      {detail === null ? null : <span className="min-w-0 text-xs wrap-anywhere text-muted-foreground">{detail}</span>}
    </span>
  );
}
