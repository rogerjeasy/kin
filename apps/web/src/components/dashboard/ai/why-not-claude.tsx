import type { FallbackReason } from "@kin/agent/provenance";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = { why: FallbackReason; copy: Dictionary["aiProvenance"] };

/** When a reading could not be made at all, the short reason Claude was not used, so the failure is never unexplained. */
export function WhyNotClaude({ why, copy }: Props) {
  return <p className="text-sm text-muted-foreground">{fill(copy.unavailable, { reason: copy.reasons[why] })}</p>;
}
