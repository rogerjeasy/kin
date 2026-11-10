import { CalendarCheckIcon, CalendarXIcon, FileWarningIcon } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { Tag } from "@/components/shared/tag";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

export type ReportView =
  | {
      readonly id: string;
      readonly state: "accepted";
      readonly agency: string;
      readonly caregiver: string;
      readonly known: boolean;
      readonly when: string;
      readonly checkedIn: string | null;
      readonly checkedOut: string | null;
      readonly minutes: string;
      readonly note: string | null;
      readonly matched: boolean;
      readonly seeded: boolean;
      readonly received: string;
    }
  | { readonly id: string; readonly state: "refused"; readonly agency: string; readonly received: string };

type Props = { reports: readonly ReportView[]; copy: Dictionary["openKin"]["agency"]; sampleLabel: string; shiftsHref: string };

/** The visits agencies reported, as evidence beside Kin's own calendar. The agency's words are quoted as its own; nothing here pays. */
export function ReportList({ reports, copy, sampleLabel, shiftsHref }: Props) {
  if (reports.length === 0) return <p className="text-sm text-muted-foreground">{copy.noReports}</p>;
  return (
    <ul className="grid min-w-0 gap-3">
      {reports.map((report) =>
        report.state === "refused" ? (
          <li key={report.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-dashed p-3 text-sm">
            <FileWarningIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <p className="min-w-0">
              <span className="font-medium">{report.agency}</span> · <time>{report.received}</time>
              <span className="block text-muted-foreground">{copy.refused}</span>
            </p>
          </li>
        ) : (
          <li key={report.id} className="grid min-w-0 gap-2 rounded-2xl border bg-background/70 p-3 sm:p-4">
            <div className="flex min-w-0 flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 basis-56 font-semibold text-balance">{fill(copy.report, { agency: report.agency, caregiver: report.caregiver })}</p>
              <StatusPill tone={report.matched ? "positive" : "neutral"} icon={report.matched ? CalendarCheckIcon : CalendarXIcon}>
                {report.matched ? copy.matched : report.known ? copy.unmatched : copy.unknownCaregiver}
              </StatusPill>
              {report.seeded ? <Tag>{sampleLabel}</Tag> : null}
            </div>
            <p className="text-sm">{report.when}</p>
            <p className="text-sm text-muted-foreground">
              {[report.checkedIn ? fill(copy.checkedIn, { time: report.checkedIn }) : null, report.checkedOut ? fill(copy.checkedOut, { time: report.checkedOut }) : null, report.minutes].filter((part) => part !== null).join(" · ")}
            </p>
            {report.note ? <blockquote className="border-s-2 ps-3 text-sm text-pretty text-muted-foreground italic">{fill(copy.note, { note: report.note })}</blockquote> : null}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-2">
              <p className="text-xs font-medium text-muted-foreground">{copy.evidence}</p>
              {report.matched ? (
                <Link href={shiftsHref} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
                  {copy.shiftsLink}
                </Link>
              ) : null}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
