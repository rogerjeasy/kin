import type { CircleSnapshot, ReceiptRecord } from "@kin/db";
import type { ProposalState } from "@kin/domain";

import type { PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import type { Formatters } from "@/lib/format";
import type { CircleNames } from "./names";

type Fairness = Dictionary["dashboard"]["fairness"];

const RECEIPT_TONES = { submitted: "waiting", approved: "waiting", rejected: "danger", credited: "positive" } as const satisfies Record<ReceiptRecord["state"], PillTone>;

const PAYMENT_TONES = {
  proposed: "waiting",
  pending_approval: "waiting",
  approved: "waiting",
  executing: "waiting",
  settled: "positive",
  failed: "danger",
  rejected: "danger",
  expired: "neutral",
  cancelled: "neutral",
} as const satisfies Record<ProposalState, PillTone>;

export type ReceiptRow = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly amount: string;
  readonly stateText: string;
  readonly tone: PillTone;
  /** Another member may decide on it: it waits, and it is not the viewer's own. */
  readonly decidable: boolean;
  /** The viewer's own receipt, still waiting for someone else. */
  readonly ownWaiting: boolean;
};

/** Each receipt as the screen words it, newest first. */
export function receiptRows(circle: CircleSnapshot, names: CircleNames, format: Formatters, copy: Fairness["receipts"]): ReceiptRow[] {
  return circle.receipts
    .map((receipt): ReceiptRow => {
      const who = names.member(receipt.memberId);
      const own = receipt.memberId === circle.viewer.memberId;
      return {
        id: receipt.id,
        title: receipt.description,
        detail: fill(copy.line, { name: who, category: names.category(receipt.category), date: format.day(receipt.spentOn) }),
        amount: format.money(receipt.cents),
        stateText: fill(copy.states[receipt.state], { name: who }),
        tone: RECEIPT_TONES[receipt.state],
        decidable: receipt.state === "submitted" && !own,
        ownWaiting: receipt.state === "submitted" && own,
      };
    })
    .toReversed();
}

export type PaymentRow = { readonly id: string; readonly who: string; readonly amount: string; readonly stateText: string; readonly tone: PillTone };

/** The payouts of the latest settlement the circle has not set aside, with where each stands. */
export function settlementPayments(circle: CircleSnapshot, names: CircleNames, format: Formatters, states: Fairness["settlementRun"]["states"], payoutWord: string): PaymentRow[] {
  const live = circle.settlements.filter((settlement) => settlement.state !== "superseded").at(-1);
  if (live === undefined) return [];
  return circle.proposals
    .filter((proposal) => proposal.settlementId === live.id && proposal.kind === "member_payout")
    .map((proposal) => ({
      id: proposal.id,
      who: fill(payoutWord, { name: "memberId" in proposal.to ? names.member(proposal.to.memberId) : "" }),
      amount: format.money(proposal.cents),
      stateText: states[proposal.state],
      tone: PAYMENT_TONES[proposal.state],
    }));
}

/** Whether the open period still has no settlement put to the family. */
export function hasLiveSettlement(circle: CircleSnapshot, period: string): boolean {
  return circle.settlements.some((settlement) => settlement.period === period && settlement.state !== "superseded");
}
