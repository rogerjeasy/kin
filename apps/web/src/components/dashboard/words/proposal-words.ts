import type { ProposalRecord } from "@kin/db";

import type { CircleNames } from "@/content/circle/names";
import type { ProposalView } from "@/content/circle/proposal-view";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type Purposes = Dictionary["dashboard"]["approvals"]["purposes"];
type Purpose = keyof Purposes;

/** The dictionary's words for a proposal's purpose, or `null` for one it does not know. */
export function purposeWords(dictionary: Dictionary, purpose: string): Purposes[Purpose] | null {
  const purposes = dictionary.dashboard.approvals.purposes;
  return Object.hasOwn(purposes, purpose) ? purposes[purpose as Purpose] : null;
}

/** Who a proposal pays, by name. */
export function recipientName(names: CircleNames, proposal: ProposalRecord): string {
  return "payeeId" in proposal.to ? names.payee(proposal.to.payeeId) : names.member(proposal.to.memberId);
}

/** A proposal's title: its purpose in the reader's language, or who it pays. */
export function proposalTitle(dictionary: Dictionary, names: CircleNames, proposal: ProposalRecord, month: string): string {
  const words = purposeWords(dictionary, proposal.purpose);
  const recipient = recipientName(names, proposal);
  if (words === null) return recipient;
  return fill(words.title, { name: recipient, month });
}

export type ProposalStatus = { tone: "waiting" | "neutral"; text: string };

/** Whose yes a proposal waits for, from the viewer's side. */
export function proposalStatus(dictionary: Dictionary, names: CircleNames, format: Formatters, view: ProposalView): ProposalStatus {
  const { status } = dictionary.dashboard.approvals;
  if (view.decision === "paused") {
    return { tone: "neutral", text: dictionary.dashboard.common.planLabels.paused };
  }
  if (view.viewerCanAnswer) {
    return { tone: "waiting", text: status.yourTurn };
  }
  const waiting = [...new Set(view.slots.flatMap((slot) => slot.waitingFor))];
  return { tone: "neutral", text: fill(status.waitingFor, { names: format.anyOf(waiting.map(names.member)) }) };
}
