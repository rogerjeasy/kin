import { formatMoney } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import type { TopUpPhase } from "./use-top-up";

type Copy = Dictionary["dashboard"]["topUp"];

/** What went wrong with the last try, while the payer can try again. */
export function problemText(phase: TopUpPhase, copy: Copy): string | null {
  if (phase.kind === "cancelled") return copy.cancelled;
  if (phase.kind === "declined") return copy.declined;
  if (phase.kind === "failed") return copy.failed;
  return null;
}

/** Where a top-up under way stands. */
export function progressText(phase: TopUpPhase, copy: Copy, money: { locale: string; currency: string }): string {
  if (phase.kind === "paying") return copy.paying;
  if (phase.kind === "confirming") return copy.confirming;
  if (phase.kind === "confirmed") return fill(copy.confirmed, { amount: formatMoney({ cents: phase.cents, currency: money.currency }, money.locale) });
  return copy.slow;
}

/** Whether the payer is choosing an amount, rather than watching one go through. */
export function isChoosing(phase: TopUpPhase): boolean {
  return phase.kind === "choose" || phase.kind === "cancelled" || phase.kind === "declined" || phase.kind === "failed";
}
