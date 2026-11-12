import type { MoneyKind, PoolProvenance } from "@/content/circle/provenance";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type Stats = Dictionary["dashboard"]["overview"]["stats"];

/** Where the pool's money came from: PayPal's record, the demo's simulation, or both. */
export function poolNote(copy: Stats["pool"], provenance: PoolProvenance, format: Formatters): string {
  if (provenance.kind === "paypal") return copy.note;
  // Real sandbox money only went out (a refill the pharmacy charged): no top-up to name, so the pool is still simulated money.
  if (provenance.kind === "simulated" || provenance.sandboxInCents === 0) return copy.simulated;
  return fill(copy.mixed, { amount: format.money(provenance.sandboxInCents) });
}

/**
 * Which figure the pool is: its whole PayPal balance, the parent's Purse
 * included, and the part the family's bills can draw on. `null` when nothing
 * is set aside, so the two are the same.
 */
export function poolSplit(copy: Stats["pool"], totals: { readonly freeCents: number; readonly purseCents: number }, parent: string, format: Formatters): string | null {
  if (totals.purseCents <= 0) return null;
  return fill(copy.split, { purse: format.money(totals.purseCents), free: format.money(totals.freeCents), parent });
}

/** The month's PayPal fees, said as simulated when they are. */
export function feesNote(copy: Stats["paidOut"], kind: MoneyKind, fees: string): string {
  const template = kind === "paypal" ? copy.note : kind === "simulated" ? copy.simulatedNote : copy.mixedNote;
  return fill(template, { fees });
}
