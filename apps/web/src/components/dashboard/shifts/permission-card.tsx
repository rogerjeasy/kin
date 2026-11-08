import { BanIcon, PauseIcon, ShieldCheckIcon } from "lucide-react";

import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { shareFills } from "@/components/shared/share-colors";
import { readBack, type PermissionCopy } from "@/content/circle/shift-permission-words";
import type { PermissionView } from "@/content/circle/shift-permissions";
import { durationText, type ShiftCopy } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { PermissionActions } from "./permission-actions";

type Props = { copy: PermissionCopy; shifts: ShiftCopy; format: Formatters; view: PermissionView; caregiver: string; parent: string; recordedBy: string };

const STATUS = {
  active: { tone: "positive", icon: ShieldCheckIcon },
  paused: { tone: "waiting", icon: PauseIcon },
  revoked: { tone: "neutral", icon: BanIcon },
} as const;

const SEAL_CHARS = 12;

/** One standing permission for shifts: what it allows read back in full, today's use, the words that granted it, and what was paid under it. */
export function PermissionCard({ copy, shifts, format, view, caregiver, parent, recordedBy }: Props) {
  const { permission } = view;
  const status = STATUS[permission.status];
  const terms = { payeeId: permission.payeeId, maxMinutesPerDay: permission.maxMinutesPerDay, perShiftCents: permission.perShiftCents, validFrom: permission.validFrom, expiresOn: permission.expiresOn };
  const used = fill(copy.used, { used: durationText(shifts, format, permission.usedMinutesToday), cap: durationText(shifts, format, permission.maxMinutesPerDay) });
  return (
    <li className="min-w-0 space-y-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-base font-medium text-pretty">{readBack(copy, shifts, format, terms, caregiver)}</p>
        <StatusPill tone={status.tone} icon={status.icon}>{copy.statuses[permission.status]}</StatusPill>
      </div>
      {view.aboveUsualCents > 0 ? <p className="text-sm font-medium text-pretty">{fill(copy.aboveUsual.tag, { parent, over: format.money(view.aboveUsualCents) })}</p> : null}
      {permission.spokenText ? <p className="text-sm text-muted-foreground text-pretty">{fill(copy.spoke, { parent, text: permission.spokenText })}</p> : null}
      <div className="space-y-1.5">
        <p className="text-sm tabular-nums">{used}</p>
        <MeterBar value={permission.usedMinutesToday} max={permission.maxMinutesPerDay} fill={shareFills[0]} label={used} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{copy.usesTitle}</h3>
        {permission.uses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.noUses}</p>
        ) : (
          <ul className="space-y-0.5 text-sm tabular-nums">
            {permission.uses.map((use) => (
              <li key={use.proposalId}>{fill(copy.useLine, { amount: format.money(use.cents), duration: durationText(shifts, format, use.minutes), day: format.day(use.day) })}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground wrap-anywhere">
        {fill(copy.recordedBy, { name: recordedBy })} · {fill(copy.sealed, { digest: permission.digest.slice(0, SEAL_CHARS) })}
        {permission.simulated ? ` · ${copy.simulatedTag}` : ""}
      </p>
      {view.canPause || view.canResume || view.canEnd ? <PermissionActions permissionId={permission.id} canPause={view.canPause} canResume={view.canResume} canEnd={view.canEnd} copy={copy.actions} shifts={shifts} /> : null}
    </li>
  );
}
