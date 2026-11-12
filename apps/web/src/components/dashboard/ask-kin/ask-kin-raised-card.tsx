import type { Dictionary } from "@/i18n/dictionary";
import type { AskKinRaised } from "@/server/ask-kin/ask-kin";

import { AskKinOrdered } from "./ask-kin-ordered";
import { AskKinProposal } from "./ask-kin-proposal";

type Props = { raised: AskKinRaised | null; copy: Dictionary["askKin"] };

/** What the question raised, worded for where it truly stands: waiting for the family, for the parent, or already approved by her standing permission. */
export function AskKinRaisedCard({ raised, copy }: Props) {
  if (raised === null) return null;
  if (raised.kind === "standing_permission") return <AskKinOrdered raised={raised} copy={copy.orderedProposal} />;
  return <AskKinProposal href={raised.href} copy={raised.kind === "purse_payment" ? copy.purseProposal : copy.proposal} />;
}
