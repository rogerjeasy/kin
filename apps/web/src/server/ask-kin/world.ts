import type { ExecutionRecord, CircleSnapshot, Database } from "@kin/db";
import { sameName } from "@kin/domain";
import type { PayPalPool } from "@kin/paypal";

import { circleFormatters } from "@/content/circle/format";
import { circleNames, type CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { Formatters } from "@/lib/format";

/** The only PayPal calls a tool can reach: reads. No write of the pool's account is in this type. */
export type PayPalReader = Pick<PayPalPool, "getPayoutBatch" | "getCapture" | "getSubscription">;

/** Copies only the read methods, so a write of the pool's account is not even reachable at run time. */
export function paypalReader(pool: PayPalPool): PayPalReader {
  return { getPayoutBatch: pool.getPayoutBatch, getCapture: pool.getCapture, getSubscription: pool.getSubscription };
}

/**
 * Everything Ask Kin's tools read, for one person's question: their circle as
 * row-level security let them read it, and the ways the screens name and
 * format it. Nothing here is taken from the model.
 */
export type AskKinWorld = {
  readonly circle: CircleSnapshot;
  readonly locale: Locale;
  readonly copy: Dictionary["askKin"];
  readonly format: Formatters;
  readonly names: CircleNames;
  readonly db: Database;
  readonly userId: string;
  /** PayPal reads for a real circle, or `null` when this deployment has no PayPal app. */
  readonly paypal: PayPalReader | null;
  /** The circle's executions, read as the person. */
  readonly executions: () => Promise<readonly ExecutionRecord[]>;
};

export function askKinWorld(input: Omit<AskKinWorld, "copy" | "format" | "names"> & { readonly dictionary: Dictionary }): AskKinWorld {
  const { dictionary, ...rest } = input;
  return { ...rest, copy: dictionary.askKin, format: circleFormatters(input.locale, input.circle), names: circleNames(input.circle, dictionary) };
}

/** Whether a name the model gave matches one the record holds; no name matches everything. */
export function named(asked: string | undefined, name: string): boolean {
  return asked === undefined || sameName(asked, name);
}

/** The circle's demo money is simulated, and every tool says so in its data. */
export function simulatedNote(world: AskKinWorld): string {
  return world.circle.circle.demo ? ` ${world.copy.facts.simulated}` : "";
}
