import { BotIcon, KeyRoundIcon, TerminalIcon } from "lucide-react";

import { IconTile } from "@/components/dashboard/ui/icon-tile";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { Tag } from "@/components/shared/tag";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { CallList, type CallView } from "./call-list";
import { RevokeButton } from "./revoke-button";

export type DelegationView = {
  readonly id: string;
  readonly label: string;
  /** Who connected it, when it is not the viewer. */
  readonly grantedBy: string | null;
  readonly scope: "read" | "propose";
  readonly status: "live" | "revoked" | "expired";
  readonly until: string;
  readonly hint: string;
  readonly lastUsed: string | null;
  readonly console: boolean;
  readonly seeded: boolean;
  readonly canRevoke: boolean;
  readonly calls: readonly CallView[];
};

type Props = { delegation: DelegationView; copy: Dictionary["openKin"]["list"]; toolLabels: Readonly<Record<string, string>> };

/** One assistant with access: who connected it, what it may do, whether it is live, and each call it made. */
export function DelegationCard({ delegation, copy, toolLabels }: Props) {
  const status = delegation.status === "live" ? fill(copy.live, { date: delegation.until }) : copy[delegation.status];
  return (
    <li className="min-w-0 surface rounded-3xl p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <IconTile icon={delegation.console ? TerminalIcon : BotIcon} />
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="font-semibold wrap-anywhere">{delegation.console ? copy.console : delegation.label}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {delegation.grantedBy ? fill(copy.grantedBy, { name: delegation.grantedBy }) : null}
            {delegation.grantedBy ? " · " : null}
            <span className="inline-flex items-center gap-1">
              <KeyRoundIcon aria-hidden="true" className="size-3.5" />
              {fill(copy.token, { hint: delegation.hint })}
            </span>
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusPill tone={delegation.scope === "propose" ? "waiting" : "neutral"}>{copy.scope[delegation.scope]}</StatusPill>
          <StatusPill tone={delegation.status === "live" ? "positive" : "neutral"}>{status}</StatusPill>
          {delegation.seeded ? <Tag>{copy.sample}</Tag> : null}
        </div>
      </div>
      <div className="mt-4 grid min-w-0 gap-2">
        <h4 className="text-sm font-semibold">{copy.calls}</h4>
        <CallList calls={delegation.calls} copy={copy} toolLabels={toolLabels} />
      </div>
      <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-sm text-muted-foreground">{delegation.lastUsed ? fill(copy.lastUsed, { date: delegation.lastUsed }) : copy.neverUsed}</p>
        {delegation.canRevoke && delegation.status === "live" ? (
          <RevokeButton
            url="/api/connections"
            id={delegation.id}
            label={copy.revoke}
            accessibleLabel={fill(copy.revokeFor, { label: delegation.console ? copy.console : delegation.label })}
            pendingLabel={copy.revoking}
            failedLabel={copy.revokeFailed}
          />
        ) : null}
      </div>
    </li>
  );
}
