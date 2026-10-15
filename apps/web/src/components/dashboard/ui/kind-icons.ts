import type { ProposalKind } from "@kin/domain";
import { HeartHandshakeIcon, PillIcon, ReceiptTextIcon, ScaleIcon, type LucideIcon } from "lucide-react";

export const proposalKindIcons: Record<ProposalKind, LucideIcon> = {
  bill_payment: ReceiptTextIcon,
  caregiver_payout: HeartHandshakeIcon,
  member_payout: ScaleIcon,
  purchase: PillIcon,
};
