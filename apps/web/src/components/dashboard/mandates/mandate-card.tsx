import { BanIcon, PauseIcon, ShieldCheckIcon } from "lucide-react";

import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { shareFills } from "@/components/shared/share-colors";
import { readBack } from "@/content/circle/mandate-words";
import type { MandateView } from "@/content/circle/mandates";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { MandateActions } from "./mandate-actions";

type Props = {
  copy: Dictionary["dashboard"]["mandates"];
  format: Formatters;
  view: MandateView;
  seller: string;
  parent: string;
  recordedBy: string;
};

const STATUS = {
  active: { tone: "positive", icon: ShieldCheckIcon },
  paused: { tone: "waiting", icon: PauseIcon },
  revoked: { tone: "neutral", icon: BanIcon },
} as const;

const SEAL_CHARS = 12;

/**
 * One standing permission: what it allows read back in full, how much of the
 * month it has used, the words that granted it, and what was bought under it.
 */
export function MandateCard({ copy, format, view, seller, parent, recordedBy }: Props) {
  const { mandate, item } = view;
  const status = STATUS[mandate.status];
  const terms = { ruleId: mandate.ruleId, perPurchaseCents: mandate.perPurchaseCents, perPeriodCents: mandate.perPeriodCents, cadence: mandate.cadence, validFrom: mandate.validFrom, expiresOn: mandate.expiresOn };
  return (
    <li className="min-w-0 space-y-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-base font-medium text-pretty">{readBack(copy, format, terms, { item, seller })}</p>
        <StatusPill tone={status.tone} icon={status.icon}>{copy.statuses[mandate.status]}</StatusPill>
      </div>
      {view.aboveUsualCents > 0 ? <p className="text-sm font-medium text-pretty">{fill(copy.aboveUsual.tag, { parent, over: format.money(view.aboveUsualCents) })}</p> : null}
      {mandate.spokenText ? <p className="text-sm text-muted-foreground text-pretty">{fill(copy.spoke, { parent, text: mandate.spokenText })}</p> : null}
      <div className="space-y-1.5">
        <p className="text-sm tabular-nums">{fill(copy.used, { used: format.money(mandate.usedCents), cap: format.money(mandate.perPeriodCents) })}</p>
        <MeterBar value={mandate.usedCents} max={mandate.perPeriodCents} fill={shareFills[0]} label={fill(copy.used, { used: format.money(mandate.usedCents), cap: format.money(mandate.perPeriodCents) })} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{copy.usesTitle}</h3>
        {mandate.uses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.noUses}</p>
        ) : (
          <ul className="space-y-0.5 text-sm tabular-nums">
            {mandate.uses.map((use) => (
              <li key={use.proposalId}>{fill(copy.useLine, { amount: format.money(use.cents), day: format.dateTime(use.at) })}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs break-all text-muted-foreground">
        {fill(copy.recordedBy, { name: recordedBy })} · {fill(copy.sealed, { digest: mandate.digest.slice(0, SEAL_CHARS) })}
        {mandate.simulated ? ` · ${copy.simulatedTag}` : ""}
      </p>
      {view.canPause || view.canResume || view.canEnd ? (
        <MandateActions mandateId={mandate.id} canPause={view.canPause} canResume={view.canResume} canEnd={view.canEnd} copy={copy.actions} errors={copy.errors} />
      ) : null}
    </li>
  );
}
