import { rosesMonth } from "@kin/domain";

import type { SlotItem } from "@/components/dashboard/approvals/approval-slots";
import type { ProposalCardProps } from "@/components/dashboard/approvals/proposal-card";
import { DEMO_NOW } from "@/content/demo-circle/clock";
import type { ProposalView, SlotView } from "@/content/demo-circle/proposal-view";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { isMember, nameOf } from "./names";
import { proposalTitle } from "./proposal-words";

const { approvals: terms } = rosesMonth.agreement;

function slotItem(dictionary: Dictionary, format: Formatters, slot: SlotView): SlotItem {
  const { slots } = dictionary.dashboard.approvals;
  const title = {
    parent_decides: fill(slots.parent_decides, { amount: format.money(terms.parentDecidesAboveCents) }),
    organizer: slots.organizer,
    second_approval: fill(slots.second_approval, { amount: format.money(terms.secondApprovalAboveCents) }),
  }[slot.reason];

  if (slot.filledBy) {
    const { memberId, method, at } = slot.filledBy;
    return {
      title,
      filled: true,
      detail: fill(slots.saidYes, { name: nameOf(dictionary, memberId), method: slots.methods[method], time: format.dateTime(at) }),
    };
  }
  const waiting = fill(slots.open, { names: format.anyOf(slot.waitingFor.map((id) => nameOf(dictionary, id))) });
  return { title, filled: false, detail: waiting, note: slot.waitingFor.includes("rose") ? slots.parentCall : undefined };
}

function notesFor(dictionary: Dictionary, format: Formatters, view: ProposalView, poolCents: number): string[] {
  const { notes } = dictionary.dashboard.approvals;
  const { plan, proposal } = view;
  return [
    plan.announceToCircle ? notes.newPayee : null,
    plan.payeeMemberId && isMember(plan.payeeMemberId) ? fill(notes.payeeIsMember, { name: nameOf(dictionary, plan.payeeMemberId) }) : null,
    proposal.cents > poolCents ? fill(notes.abovePool, { pool: format.money(poolCents) }) : null,
  ].filter((note) => note !== null);
}

/** Everything a proposal card shows, except the viewer's buttons. */
export function proposalCardProps(
  dictionary: Dictionary,
  format: Formatters,
  view: ProposalView,
  poolCents: number,
): Omit<ProposalCardProps, "action"> {
  const { approvals, common } = dictionary.dashboard;
  const { proposal, plan, slots } = view;
  const purpose = approvals.purposes[proposal.purpose];
  return {
    id: proposal.id,
    kind: proposal.kind,
    kindLabel: common.proposalKinds[proposal.kind],
    title: proposalTitle(dictionary, proposal),
    text: purpose.text,
    amount: format.money(proposal.cents),
    meta: [
      fill(approvals.raisedBy, { name: nameOf(dictionary, proposal.raisedBy), date: format.dateTime(proposal.raisedAt) }),
      fill(approvals.expires, { when: format.hoursUntil(plan.expiresAt, DEMO_NOW) }),
    ],
    notes: notesFor(dictionary, format, view, poolCents),
    slotsLabel: approvals.slots.label,
    progress: fill(approvals.progress, {
      done: format.count(slots.filter((slot) => slot.filledBy !== null).length),
      total: format.count(slots.length),
    }),
    slots: slots.map((slot) => slotItem(dictionary, format, slot)),
  };
}
