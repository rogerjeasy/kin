import { BuildingIcon } from "lucide-react";

import { IconTile } from "@/components/dashboard/ui/icon-tile";
import { Panel } from "@/components/dashboard/ui/panel";
import { Tag } from "@/components/shared/tag";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { AgencyKeyForm } from "./agency-key-form";
import { ReportList, type ReportView } from "./report-list";
import { RevokeButton } from "./revoke-button";

export type AgencyKeyView = { readonly id: string; readonly label: string; readonly created: string; readonly lastReport: string | null; readonly revoked: boolean; readonly seeded: boolean };

type Props = {
  copy: Dictionary["openKin"];
  keys: readonly AgencyKeyView[];
  reports: readonly ReportView[];
  /** Whether the viewer may create and revoke keys: the organizer. */
  canManage: boolean;
  origin: string;
  /** A caregiver's name from the circle, for the example request. */
  caregiver: string;
  shiftsHref: string;
};

/** The agencies connected to the circle, and the visits they reported as evidence beside the calendar. */
export function AgencyPanel({ copy, keys, reports, canManage, origin, caregiver, shiftsHref }: Props) {
  const { agency } = copy;
  return (
    <Panel title={agency.title} description={agency.lede}>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="grid min-w-0 content-start gap-4">
          <h3 className="font-semibold">{agency.keys}</h3>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{agency.noKeys}</p>
          ) : (
            <ul className="grid min-w-0 gap-3">
              {keys.map((key) => (
                <li key={key.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border bg-background/70 p-3">
                  <IconTile icon={BuildingIcon} />
                  <p className="min-w-0 flex-1 basis-40">
                    <span className="block font-medium wrap-anywhere">{key.label}</span>
                    <span className="block text-sm text-muted-foreground">
                      {key.revoked ? agency.revoked : fill(agency.created, { date: key.created })}
                      {key.revoked ? null : ` · ${key.lastReport ? fill(agency.lastReport, { date: key.lastReport }) : agency.noReport}`}
                    </span>
                  </p>
                  {key.seeded ? <Tag>{copy.list.sample}</Tag> : null}
                  {canManage && !key.revoked ? (
                    <RevokeButton url="/api/agency-keys" id={key.id} label={agency.revoke} accessibleLabel={fill(agency.revokeFor, { label: key.label })} pendingLabel={copy.list.revoking} failedLabel={copy.list.revokeFailed} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? <AgencyKeyForm copy={agency.create} tokenCopy={copy.token} origin={origin} caregiver={caregiver} /> : <p className="text-sm text-muted-foreground">{agency.readOnly}</p>}
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <h3 className="font-semibold">{agency.reports}</h3>
          <ReportList reports={reports} copy={agency} sampleLabel={copy.list.sample} shiftsHref={shiftsHref} />
        </div>
      </div>
    </Panel>
  );
}
