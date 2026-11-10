import type { PayoutReason } from "@/content/circle/fairness";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type Reasons = Dictionary["dashboard"]["fairness"]["settlement"]["reasons"];

/** Why a payout goes now in full, in part or not yet, in a sentence. `now` is the part payable now, formatted. */
export function payoutReasonWords(copy: Reasons, reason: PayoutReason, now: string, format: Formatters): string {
  return fill(copy[reason.kind], { available: format.money(reason.availableCents), now, rest: format.money(reason.restCents) });
}
