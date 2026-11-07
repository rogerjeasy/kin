import type { CircleSnapshot } from "@kin/db";
import type { ReviewItem } from "@kin/agent";
import { entryFigures, type VerificationReport } from "@kin/verify";

import type { Dictionary } from "@/i18n/dictionary";
import type { Formatters } from "@/lib/format";
import { fill } from "@/i18n/template";

import { entryView } from "./record";

const SEVERITY = { reversal: "info", payout_above_usual: "attention", simulated_and_real: "info" } as const;

/**
 * What the verifier found, as items for the auditor to word: each failed
 * check is serious, and each observation is for information or worth a look.
 * The fixed sentence of every item names no one and no payee, only figures
 * and days, so what reaches the model is as little as the task needs.
 */
export function reviewItems(report: VerificationReport, circle: CircleSnapshot, dictionary: Dictionary, format: Formatters): ReviewItem[] {
  const { findings, observations } = dictionary.dashboard.verify;
  const failed = report.checks
    .filter((check) => !check.ok)
    .map((check): ReviewItem => ({ id: `check-${check.id}`, severity: "critical", entryId: check.entryIds[0] ?? null, figures: [], template: findings[check.id] }));
  const noticed = report.observations.map((each, index): ReviewItem => {
    const entry = circle.ledger.entries.find((candidate) => candidate.id === each.entryId);
    const view = entry === undefined ? null : entryView(entry);
    const amount = view === null ? "" : format.money(view.cents);
    const day = entry === undefined ? "" : format.day(entry.occurredOn);
    return {
      id: `observation-${index}`,
      severity: SEVERITY[each.code],
      entryId: each.entryId,
      figures: entry === undefined ? [] : [amount, day, ...entryFigures(entry)],
      template: fill(observations[each.code], { amount, day }),
    };
  });
  return [...failed, ...noticed];
}
