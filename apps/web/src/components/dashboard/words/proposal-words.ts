import type { ProposalView } from "@/content/demo-circle/proposal-view";
import type { DemoProposal } from "@/content/demo-circle/proposals";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { nameOf, payeeName } from "./names";

/** Who a proposal pays, by name. */
export function recipientName(dictionary: Dictionary, proposal: DemoProposal): string {
  return "payeeId" in proposal.to ? payeeName(dictionary, proposal.to.payeeId) : nameOf(dictionary, proposal.to.memberId);
}

export function proposalTitle(dictionary: Dictionary, proposal: DemoProposal): string {
  const { purposes } = dictionary.dashboard.approvals;
  if (proposal.purpose === "settlement") {
    return fill(purposes.settlement.title, { name: recipientName(dictionary, proposal) });
  }
  return purposes[proposal.purpose].title;
}

export type ProposalStatus = { tone: "waiting" | "neutral"; text: string };

/** Whose yes a proposal waits for, from the viewer's side. */
export function proposalStatus(dictionary: Dictionary, format: Formatters, view: ProposalView): ProposalStatus {
  const { status } = dictionary.dashboard.approvals;
  if (view.viewerCanAnswer) {
    return { tone: "waiting", text: status.yourTurn };
  }
  const waiting = [...new Set(view.slots.flatMap((slot) => slot.waitingFor))];
  const names = format.anyOf(waiting.map((id) => nameOf(dictionary, id)));
  return { tone: "neutral", text: fill(status.waitingFor, { names }) };
}
