import { matchVisitReport } from "@kin/domain";
import type { AgencyKeyRecord, AgencyReportRecord, CircleSnapshot, DelegationRecord } from "@kin/db";

import type { CallView } from "@/components/dashboard/connections/call-list";
import type { DelegationView } from "@/components/dashboard/connections/delegation-card";
import type { ReportView } from "@/components/dashboard/connections/report-list";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

/**
 * The Connected assistants screen's rows, worded from the record. Whether a
 * delegation is live is decided against the real clock, as the server decides
 * it when a token is used; a report's match to a shift is decided by the
 * domain's own rule.
 */

type Names = { readonly member: (id: string) => string };

export function delegationViews(input: { readonly delegations: readonly DelegationRecord[]; readonly circle: CircleSnapshot; readonly names: Names; readonly format: Formatters; readonly now: Date }): DelegationView[] {
  const { circle, names, format, now } = input;
  const me = circle.viewer.memberId;
  const organizer = circle.viewer.role === "organizer";
  return input.delegations.map((delegation) => ({
    id: delegation.id,
    label: delegation.label,
    grantedBy: delegation.memberId === me ? null : names.member(delegation.memberId),
    scope: delegation.scope,
    status: delegation.revokedAt !== null ? "revoked" : delegation.expiresAt <= now ? "expired" : "live",
    until: format.dateTime(delegation.expiresAt),
    hint: delegation.tokenHint,
    lastUsed: delegation.lastUsedAt === null ? null : format.dateTime(delegation.lastUsedAt),
    console: delegation.console,
    seeded: delegation.seeded,
    canRevoke: delegation.memberId === me || organizer,
    calls: delegation.calls.map((call): CallView => ({ id: call.id, tool: call.tool, outcome: call.outcome, at: format.dateTime(call.at), proposed: call.proposalId !== null })),
  }));
}

export function reportViews(input: { readonly reports: readonly AgencyReportRecord[]; readonly keys: readonly AgencyKeyRecord[]; readonly circle: CircleSnapshot; readonly copy: Dictionary["openKin"]["agency"]; readonly kinds: Dictionary["dashboard"]["shifts"]["kinds"]; readonly format: Formatters }): ReportView[] {
  const { circle, copy, kinds, format } = input;
  const agencyOf = (id: string) => input.keys.find((key) => key.id === id)?.label ?? "";
  const shifts = circle.shifts.map((shift) => ({ id: shift.id, memberId: shift.memberId, kind: shift.kind, startsAt: shift.startsAt, endsAt: shift.endsAt, cancelled: shift.state === "cancelled" }));
  return input.reports.map((report): ReportView => {
    const received = format.dateTime(report.receivedAt);
    if (report.state === "refused" || report.kind === null || report.startsAt === null || report.endsAt === null) return { id: report.id, state: "refused", agency: agencyOf(report.agencyKeyId), received };
    const caregiver = report.caregiverMemberId === null ? (report.caregiverName ?? "") : (circle.members.find((member) => member.id === report.caregiverMemberId)?.displayName ?? report.caregiverName ?? "");
    return {
      id: report.id,
      state: "accepted",
      agency: agencyOf(report.agencyKeyId),
      caregiver,
      known: report.caregiverMemberId !== null,
      when: fill(copy.when, { kind: kinds[report.kind], from: format.dateTime(report.startsAt), to: format.time(report.endsAt) }),
      checkedIn: report.checkedInAt === null ? null : format.time(report.checkedInAt),
      checkedOut: report.checkedOutAt === null ? null : format.time(report.checkedOutAt),
      minutes: fill(copy.minutes, { count: format.count(report.minutes ?? 0) }),
      note: report.note,
      matched: matchVisitReport({ memberId: report.caregiverMemberId, kind: report.kind, startsAt: report.startsAt, endsAt: report.endsAt }, shifts) !== null,
      seeded: report.seeded,
      received,
    };
  });
}
