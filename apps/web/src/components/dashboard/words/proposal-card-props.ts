import { LETTER_BILL_PURPOSE, type ApprovalTerms } from "@kin/domain";
import type { ProposalRecord } from "@kin/db";

import type { SlotItem } from "@/components/dashboard/approvals/approval-slots";
import type { ProposalCardProps } from "@/components/dashboard/approvals/proposal-card";
import type { CircleNames } from "@/content/circle/names";
import { demoPayeeNote, type DemoPayee } from "@/content/circle/payout-proof";
import type { ProposalView, SlotView } from "@/content/circle/proposal-view";
import type { SettlementBasis } from "@/content/circle/settlement-basis";
import { voteLine } from "@/content/circle/vote-words";
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
  /** How a demo circle pays caregivers, which then never waits for an address; `null` in a real circle. */
  readonly demoPayee?: DemoPayee;
  /** What a settlement payout was worked out from, and where today's fairness is read. */
  readonly settlement?: { readonly basisOf: (proposal: ProposalRecord) => SettlementBasis | null; readonly fairnessHref: string };
};

function slotTitle(dictionary: Dictionary, context: CardContext, slot: SlotView): string {
  const { slots } = dictionary.dashboard.approvals;
  const { planLabels } = dictionary.dashboard.common;
  const { terms, format, parent } = context;
  if (terms === null) {
    return { parent_decides: fill(planLabels.parent, { parent }), organizer: planLabels.organizer, second_approval: planLabels.organizerAndSecond, independent: slots.independent }[slot.reason];
  }
  return {
    parent_decides: fill(slots.parent_decides, { amount: format.money(terms.parentDecidesAboveCents), parent }),
    organizer: slots.organizer,
    second_approval: fill(slots.second_approval, { amount: format.money(terms.secondApprovalAboveCents) }),
    independent: slots.independent,
  }[slot.reason];
}

function slotItem(dictionary: Dictionary, context: CardContext, slot: SlotView): SlotItem {
  const { slots } = dictionary.dashboard.approvals;
  const { names, format, parentId } = context;
  const title = slotTitle(dictionary, context, slot);
  if (slot.filledBy) {
    const { memberId, method, at } = slot.filledBy;
    return { title, filled: true, detail: voteLine(slots, { name: names.member(memberId), decision: "approve", method, time: format.dateTime(at) }) };
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
    plan.raiserMemberId ? fill(notes.raiserNotAlone, { name: names.member(plan.raiserMemberId) }) : null,
    poolCents !== null && proposal.cents > poolCents ? fill(notes.abovePool, { pool: format.money(poolCents), parent: context.parent }) : null,
    destination(dictionary, context, view),
    ...settlementNotes(dictionary, context, view),
  ].filter((note) => note !== null);
}

// A settlement payout says when it was worked out, and, once the record has moved, today's figure.
function settlementNotes(dictionary: Dictionary, context: CardContext, view: ProposalView): string[] {
  const { notes } = dictionary.dashboard.approvals;
  const basis = context.settlement?.basisOf(view.proposal) ?? null;
  if (basis === null) return [];
  const { format, names } = context;
  const worked = fill(notes.settlementBasis, { month: format.month(basis.period), day: format.day(basis.calculatedOn) });
  if (basis.nowOwedCents === null) return [worked];
  return [worked, fill(notes.settlementMoved, { name: names.member(basis.memberId), amount: format.money(basis.nowOwedCents) })];
}

function fairnessLink(dictionary: Dictionary, context: CardContext, view: ProposalView): ProposalCardProps["link"] {
  const basis = context.settlement?.basisOf(view.proposal) ?? null;
  if (basis === null || basis.nowOwedCents === null || context.settlement === undefined) return undefined;
  return { href: context.settlement.fairnessHref, label: dictionary.dashboard.approvals.notes.fairnessLink };
}

// A caregiver's pay goes where they said; the family sees where before saying yes.
function destination(dictionary: Dictionary, context: CardContext, view: ProposalView): string | null {
  const { notes } = dictionary.dashboard.approvals;
  const { proposal } = view;
  if (!("payeeId" in proposal.to)) return null;
  const name = context.names.payee(proposal.to.payeeId);
  // A bill read from a letter goes to the address the family entered for the company when they reviewed it.
  if (proposal.kind === "bill_payment" && proposal.purpose === LETTER_BILL_PURPOSE) {
    const receiver = context.receiverOf(proposal.to.payeeId);
    return receiver === null ? null : fill(notes.billReceiver, { address: receiver, name });
  }
  if (proposal.kind !== "caregiver_payout") return null;
  const demo = demoPayeeNote(dictionary.sandboxPayout, context.demoPayee ?? null);
  if (demo !== null) return fill(demo, { name });
  const receiver = context.receiverOf(proposal.to.payeeId);
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
    link: fairnessLink(dictionary, context, view),
    slotsLabel: approvals.slots.label,
    progress: fill(approvals.progress, {
      done: format.count(slots.filter((slot) => slot.filledBy !== null).length),
      total: format.count(slots.length),
    }),
    slots: slots.map((slot) => slotItem(dictionary, context, slot)),
  };
}
