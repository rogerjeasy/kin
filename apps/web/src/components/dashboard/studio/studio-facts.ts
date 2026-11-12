import type { StudioFairnessRow, StudioTotals } from "@/content/circle/studio-data";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { StudioCopy } from "./studio-sources";

/**
 * The record's figures as the Kin agent's tool hands them to the model: one
 * line each, every amount already written by Kin's formatter on the server,
 * so the model copies a figure and never works one out. The number guard holds
 * its answer to these words.
 */
export function studioFacts(copy: StudioCopy, totals: StudioTotals, fairness: readonly StudioFairnessRow[], format: Formatters): string[] {
  const { summary, widgets } = copy;
  const words = widgets.fairnessGap;
  return [
    `${summary.allTime}:`,
    `${summary.moneyIn}: ${format.money(totals.inCents)}`,
    `${summary.moneyOut}: ${format.money(totals.outCents)}`,
    `${summary.fees}: ${format.money(totals.feeCents)}`,
    `${summary.caregiverPay}: ${format.money(totals.caregiverPayCents)}`,
    `${summary.sandbox}: ${format.count(totals.sandboxEntries)}`,
    `${summary.simulated}: ${format.count(totals.simulatedEntries)}`,
    ...(fairness[0] === undefined ? [summary.noFairness] : [`${fill(summary.fairness, { month: format.month(fairness[0].month) })}:`]),
    ...fairness.map((row) => {
      const amount = format.money(Math.abs(row.positionCents));
      const status = row.positionCents > 0 ? fill(words.owed, { name: row.member, amount }) : row.positionCents < 0 ? fill(words.owes, { name: row.member, amount }) : fill(words.even, { name: row.member });
      return `${row.member} (${format.share(row.shareBps)}): ${fill(words.given, { amount: format.money(row.givenCents) })}, ${fill(words.agreed, { amount: format.money(row.agreedCents) })}. ${status}.`;
    }),
    `${widgets.verified.title}: ${totals.verified.length === 0 ? widgets.verified.none : totals.verified.map((entry) => `${entry.paypalId} ${format.money(entry.amountCents)}`).join("; ")}`,
  ];
}
