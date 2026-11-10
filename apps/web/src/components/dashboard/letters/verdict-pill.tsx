import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, HelpCircleIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { ClaimVerdict } from "@kin/domain";
import { shownVerdict, type ShownVerdict } from "@/content/circle/verdict";

type Labels = Record<ShownVerdict, string>;

const LOOK = {
  match: { tone: "positive", icon: CheckCircle2Icon },
  no_match: { tone: "danger", icon: AlertTriangleIcon },
  already_paid: { tone: "danger", icon: BanIcon },
  unclear: { tone: "waiting", icon: HelpCircleIcon },
} as const satisfies Record<ShownVerdict, { tone: "positive" | "danger" | "waiting"; icon: typeof CheckCircle2Icon }>;

/** A verdict in words, colour and an icon, so colour is never the only sign. */
export function VerdictPill({ verdict, payeeId, labels }: { verdict: ClaimVerdict; payeeId: string | null; labels: Labels }) {
  const shown = shownVerdict(verdict, payeeId);
  return (
    <StatusPill tone={LOOK[shown].tone} icon={LOOK[shown].icon}>
      {labels[shown]}
    </StatusPill>
  );
}
