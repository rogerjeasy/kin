import { rosesMonth, settlePeriod, type ApprovalVote, type Payee, type ProposalKind } from "@kin/domain";

import type { CircleMember } from "../circle-portraits";
import type { Sibling } from "../example-family";
import { roleOf } from "./members";
import { demoPayees, type PayeeId } from "./payees";

export type VoteMethod = "voice" | "app";

export type DemoVote = ApprovalVote & { readonly memberId: CircleMember; readonly method: VoteMethod; readonly at: Date };

export type ProposalPurpose = "stairlift" | "caregiverWeek" | "settlement";

export type DemoProposal = {
  readonly id: string;
  readonly purpose: ProposalPurpose;
  readonly kind: ProposalKind;
  readonly cents: number;
  /** Who is paid: a payee the circle knows, or a member being settled with. */
  readonly to: { readonly payeeId: PayeeId } | { readonly memberId: Sibling };
  readonly raisedBy: CircleMember | "kin";
  readonly raisedAt: Date;
  readonly votes: readonly DemoVote[];
};

function vote(memberId: CircleMember, method: VoteMethod, at: string): DemoVote {
  return { memberId, role: roleOf(memberId), decision: "approve", method, at: new Date(at) };
}

// What the settlement proposes comes from the money core, never from here.
const { plan } = settlePeriod(rosesMonth);
const SETTLED_AT = new Date("2026-10-30T17:00:00Z");

const settlementProposals: DemoProposal[] = plan.payouts.map((payout) => ({
  id: `settlement-${payout.memberId}`,
  purpose: "settlement",
  kind: "member_payout",
  cents: payout.cents,
  // Safe: the settlement pays only members who hold a share, and they are the siblings.
  to: { memberId: payout.memberId as Sibling },
  raisedBy: "kin",
  raisedAt: SETTLED_AT,
  votes: [],
}));

/**
 * The movements waiting for a yes on the demo clock. The stairlift repair has
 * Rose's spoken yes and needs one more. Amara's week waits for Rose. The
 * settlement waits for whoever its rules name.
 */
export const demoProposals: readonly DemoProposal[] = [
  {
    id: "stairlift-repair",
    purpose: "stairlift",
    kind: "bill_payment",
    cents: 90000,
    to: { payeeId: "stairlift" },
    raisedBy: "elena",
    raisedAt: new Date("2026-10-29T15:00:00Z"),
    votes: [vote("rose", "voice", "2026-10-29T16:10:00Z")],
  },
  {
    id: "amara-week-44",
    purpose: "caregiverWeek",
    kind: "caregiver_payout",
    cents: 26400,
    to: { payeeId: "amara" },
    raisedBy: "amara",
    raisedAt: new Date("2026-10-30T13:00:00Z"),
    votes: [],
  },
  ...settlementProposals,
];

/** The payee record the approval engine reads for a proposal. */
export function payeeOf(proposal: DemoProposal): Payee {
  if ("payeeId" in proposal.to) {
    return demoPayees[proposal.to.payeeId].payee;
  }
  const { memberId } = proposal.to;
  return { status: "approved", member: { memberId, role: roleOf(memberId) }, autoPay: null };
}
