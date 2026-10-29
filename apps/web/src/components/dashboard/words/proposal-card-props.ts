import type { ApprovalTerms } from "@kin/domain";

import type { SlotItem } from "@/components/dashboard/approvals/approval-slots";
import type { ProposalCardProps } from "@/components/dashboard/approvals/proposal-card";
import type { CircleNames } from "@/content/circle/names";
import type { ProposalView, SlotView } from "@/content/circle/proposal-view";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { proposalTitle, purposeWords } from "./proposal-words";

/** What a card needs to know about the circle around the proposal. */
export type CardContext = {
  readonly names: CircleNames;
  readonly format: Formatters;
  /** The agreement's thresholds, or `null` when the viewer may not see them. */
  readonly terms: ApprovalTerms | null;
  readonly parentId: string | null;
  /** The parent's name, for the places that name them. */
  readonly parent: string;
  readonly poolCents: number | null;
  readonly now: Date;
  readonly month: string;
  /** Where PayPal sends a payee's money, masked; `null` while none is recorded. */
  readonly receiverOf: (payeeId: string) => string | null;
};

function slotTitle(dictionary: Dictionary, context: CardContext, slot: SlotView): string {
  const { slots } = dictionary.dashboard.approvals;
  const { planLabels } = dictionary.dashboard.common;
  const { terms, format, parent } = context;
  if (terms === null) {
    return { parent_decides: fill(planLabels.parent, { parent }), organizer: planLabels.organizer, second_approval: planLabels.organizerAndSecond }[slot.reason];
  }
  return {
    parent_decides: fill(slots.parent_decides, { amount: format.money(terms.parentDecidesAboveCents), parent }),
    organizer: slots.organizer,
    second_approval: fill(slots.second_approval, { amount: format.money(terms.secondApprovalAboveCents) }),
  }[slot.reason];
}

function slotItem(dictionary: Dictionary, context: CardContext, slot: SlotView): SlotItem {
  const { slots } = dictionary.dashboard.approvals;
  const { names, format, parentId } = context;
  const title = slotTitle(dictionary, context, slot);
  if (slot.filledBy) {
    const { memberId, method, at } = slot.filledBy;
    return { title, filled: true, detail: fill(slots.saidYes, { name: names.member(memberId), method: slots.methods[method], time: format.dateTime(at) }) };
  }
  const waiting = fill(slots.open, { names: format.anyOf(slot.waitingFor.map(names.member)) });
  const asksParent = parentId !== null && slot.waitingFor.includes(parentId);
  return { title, filled: false, detail: waiting, note: asksParent ? fill(slots.parentCall, { parent: context.parent }) : undefined };
}

function notesFor(dictionary: Dictionary, context: CardContext, view: ProposalView): string[] {
  const { notes } = dictionary.dashboard.approvals;
  const { plan, proposal } = view;
  const { names, format, poolCents } = context;
  return [
    // An answer given now still counts once the pause lifts.
    view.decision === "paused" ? dictionary.dashboard.common.planLabels.paused : null,
    plan.announceToCircle ? notes.newPayee : null,
    plan.payeeMemberId ? fill(notes.payeeIsMember, { name: names.member(plan.payeeMemberId) }) : null,
    poolCents !== null && proposal.cents > poolCents ? fill(notes.abovePool, { pool: format.money(poolCents) }) : null,
    destination(dictionary, context, view),
  ].filter((note) => note !== null);
}

// A caregiver's pay goes where they said; the family sees where before saying yes.
function destination(dictionary: Dictionary, context: CardContext, view: ProposalView): string | null {
  const { notes } = dictionary.dashboard.approvals;
  const { proposal } = view;
  if (proposal.kind !== "caregiver_payout" || !("payeeId" in proposal.to)) return null;
  const receiver = context.receiverOf(proposal.to.payeeId);
  const name = context.names.payee(proposal.to.payeeId);
  return receiver === null ? fill(notes.noReceiver, { name }) : fill(notes.receiver, { address: receiver, name });
}

/** Everything a proposal card shows, except the viewer's buttons. */
export function proposalCardProps(dictionary: Dictionary, context: CardContext, view: ProposalView): Omit<ProposalCardProps, "action"> {
  const { approvals, common } = dictionary.dashboard;
  const { proposal, plan, slots } = view;
  const { names, format } = context;
  return {
    id: proposal.id,
    kind: proposal.kind,
    kindLabel: common.proposalKinds[proposal.kind],
    title: proposalTitle(dictionary, names, proposal, context.month),
    text: proposal.note ?? purposeWords(dictionary, proposal.purpose)?.text ?? "",
    amount: format.money(proposal.cents),
    meta: [
      fill(approvals.raisedBy, { name: names.member(proposal.raisedBy), date: format.dateTime(proposal.raisedAt) }),
      fill(approvals.expires, { when: format.hoursUntil(plan.expiresAt, context.now) }),
    ],
    notes: notesFor(dictionary, context, view),
    slotsLabel: approvals.slots.label,
    progress: fill(approvals.progress, {
      done: format.count(slots.filter((slot) => slot.filledBy !== null).length),
      total: format.count(slots.length),
    }),
    slots: slots.map((slot) => slotItem(dictionary, context, slot)),
  };
}
