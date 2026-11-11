"use client";

import type { AgWidgetParams } from "ag-studio";
import { AgIncompleteDataMappingOverlay, AgNoDataOverlay } from "ag-studio-react";
import { use } from "react";

import { shareColorAt } from "@/components/shared/share-colors";
import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { fill } from "@/i18n/template";

import { centsOf, type FairnessGapState, type StudioContext } from "./studio-context";

type Row = { readonly member: string; readonly given: number; readonly agreed: number; readonly gap: number };

/**
 * Kin's fairness gap: each member's money given beside their agreed share,
 * and what settling up would move. Every figure is the money core's own,
 * summed in whole cents by AG Studio and written by Kin's formatter.
 */
export function FairnessGapWidget({ widgetApi, dataMapping, context }: AgWidgetParams<FairnessGapState, unknown, StudioContext>) {
  const member = dataMapping.member?.at(0);
  const given = dataMapping.given?.at(0);
  const agreed = dataMapping.agreed?.at(0);
  const gap = dataMapping.gap?.at(0);
  if (!member || !given || !agreed || !gap) return <AgIncompleteDataMappingOverlay />;

  const response = use(widgetApi.getData({ fields: [member, given, agreed, gap] }, { queryId: "fairness-gap" }));
  const rows = response.results.rows.flatMap((row): Row[] => {
    const name = row[member.key];
    const values = [centsOf(row[given.key]), centsOf(row[agreed.key]), centsOf(row[gap.key])];
    if (typeof name !== "string" || values.some((value) => value === null)) return [];
    const [givenCents = 0, agreedCents = 0, gapCents = 0] = values.map((value) => value ?? 0);
    return [{ member: name, given: givenCents, agreed: agreedCents, gap: gapCents }];
  });
  if (rows.length === 0) return <AgNoDataOverlay />;

  const { copy, format } = context;
  const words = copy.widgets.fairnessGap;
  // The longest bar sets the scale: a drawing, not an amount.
  const max = Math.max(...rows.flatMap((row) => [row.given, row.agreed]));

  return (
    <ul className="flex h-full min-w-0 flex-col justify-center gap-3 overflow-auto px-4 py-3" aria-label={words.title}>
      {rows.map((row, index) => {
        const amount = format.money(Math.abs(row.gap));
        const status = row.gap > 0 ? fill(words.owed, { name: row.member, amount }) : row.gap < 0 ? fill(words.owes, { name: row.member, amount }) : fill(words.even, { name: row.member });
        const figures = `${fill(words.given, { amount: format.money(row.given) })}, ${fill(words.agreed, { amount: format.money(row.agreed) })}`;
        return (
          <li key={row.member} className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${shareColorAt(index).dot}`} />
                <span className="truncate">{row.member}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">{figures}</span>
            </div>
            <MeterBar value={row.given} max={max} target={row.agreed} fill={shareColorAt(index).fill} label={`${row.member}: ${figures}`} className="mt-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">{status}</p>
          </li>
        );
      })}
    </ul>
  );
}
