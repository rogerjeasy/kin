import { AlertTriangleIcon, CheckCircle2Icon, HelpCircleIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { ClaimVerdict } from "@kin/domain";

type Labels = Record<ClaimVerdict, string>;

const LOOK = {
  match: { tone: "positive", icon: CheckCircle2Icon },
  no_match: { tone: "danger", icon: AlertTriangleIcon },
  unclear: { tone: "waiting", icon: HelpCircleIcon },
} as const satisfies Record<ClaimVerdict, { tone: "positive" | "danger" | "waiting"; icon: typeof CheckCircle2Icon }>;

/** A verdict in words, colour and an icon, so colour is never the only sign. */
export function VerdictPill({ verdict, labels }: { verdict: ClaimVerdict; labels: Labels }) {
  return (
    <StatusPill tone={LOOK[verdict].tone} icon={LOOK[verdict].icon}>
      {labels[verdict]}
    </StatusPill>
  );
}
