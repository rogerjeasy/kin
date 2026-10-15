import type { AttentionItem } from "@/components/dashboard/overview/attention-panel";
import { dashboardRoutes } from "@/content/dashboard-routes";
import type { ProposalView } from "@/content/demo-circle/proposal-view";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import type { Formatters } from "@/lib/format";

import { proposalStatus, proposalTitle } from "./proposal-words";

/** Proposals waiting for a yes, with the viewer's own turns first. */
export function attentionItems(locale: Locale, dictionary: Dictionary, format: Formatters, views: readonly ProposalView[]): AttentionItem[] {
  return views
    .toSorted((a, b) => Number(b.viewerCanAnswer) - Number(a.viewerCanAnswer))
    .map((view) => ({
      id: view.proposal.id,
      href: `${localizedPath(locale, dashboardRoutes.approvals)}#${view.proposal.id}`,
      kind: view.proposal.kind,
      kindLabel: dictionary.dashboard.common.proposalKinds[view.proposal.kind],
      title: proposalTitle(dictionary, view.proposal),
      amount: format.money(view.proposal.cents),
      status: proposalStatus(dictionary, format, view),
    }));
}
