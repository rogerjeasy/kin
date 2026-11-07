import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, HelpCircleIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { ClaimVerdict } from "@kin/domain";

/** What a verdict is called on screen: the domain's three, and the one `no_match` that has its own name. */
export type ShownVerdict = ClaimVerdict | "already_paid";

type Labels = Record<ShownVerdict, string>;

const LOOK = {
  match: { tone: "positive", icon: CheckCircle2Icon },
  no_match: { tone: "danger", icon: AlertTriangleIcon },
  already_paid: { tone: "danger", icon: BanIcon },
  unclear: { tone: "waiting", icon: HelpCircleIcon },
} as const satisfies Record<ShownVerdict, { tone: "positive" | "danger" | "waiting"; icon: typeof CheckCircle2Icon }>;

/**
 * The name to show for a verdict. The domain says `no_match` both for a name
 * nobody knows and for a known payee already paid (`checkClaim`); only the
 * second has a payee, so a payee on a `no_match` is how a stored check tells
 * the two apart.
 */
export function shownVerdict(verdict: ClaimVerdict, payeeId: string | null): ShownVerdict {
  return verdict === "no_match" && payeeId !== null ? "already_paid" : verdict;
}

/** A verdict in words, colour and an icon, so colour is never the only sign. */
export function VerdictPill({ verdict, payeeId, labels }: { verdict: ClaimVerdict; payeeId: string | null; labels: Labels }) {
  const shown = shownVerdict(verdict, payeeId);
  return (
    <StatusPill tone={LOOK[shown].tone} icon={LOOK[shown].icon}>
      {labels[shown]}
    </StatusPill>
  );
}
