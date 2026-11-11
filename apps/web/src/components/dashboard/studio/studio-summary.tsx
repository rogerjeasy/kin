import { HandHeartIcon, ReceiptIcon, ShieldCheckIcon, TrendingDownIcon, TrendingUpIcon, FlaskConicalIcon } from "lucide-react";

import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatTile } from "@/components/dashboard/ui/stat-tile";
import { shareColorAt } from "@/components/shared/share-colors";
import type { StudioFairnessRow, StudioTotals } from "@/content/circle/studio-data";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import type { StudioCopy } from "./studio-sources";

type StudioSummaryProps = {
  readonly copy: StudioCopy;
  readonly totals: StudioTotals;
  readonly fairness: readonly StudioFairnessRow[];
  readonly format: Formatters;
};

/**
 * Kin's own read-only summary of the studio's record, written on the server
 * from the same rows: what a phone shows, and what the page falls back to if
 * AG Studio's licence lapses or the studio cannot open.
 */
export function StudioSummary({ copy, totals, fairness, format }: StudioSummaryProps) {
  const { summary, widgets } = copy;
  const words = widgets.fairnessGap;
  const max = Math.max(1, ...fairness.flatMap((row) => [row.givenCents, row.agreedCents]));
  const month = fairness[0]?.month;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel title={summary.title} description={summary.allTime}>
        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile label={summary.moneyIn} value={format.money(totals.inCents)} note={summary.allTime} icon={TrendingUpIcon} />
          <StatTile label={summary.moneyOut} value={format.money(totals.outCents)} note={summary.allTime} icon={TrendingDownIcon} />
          <StatTile label={summary.fees} value={format.money(totals.feeCents)} note={summary.allTime} icon={ReceiptIcon} />
          <StatTile label={summary.caregiverPay} value={format.money(totals.caregiverPayCents)} note={summary.allTime} icon={HandHeartIcon} />
          <StatTile label={summary.sandbox} value={format.count(totals.sandboxEntries)} note={widgets.verified.count} icon={ShieldCheckIcon} />
          <StatTile label={summary.simulated} value={format.count(totals.simulatedEntries)} note={widgets.proof} icon={FlaskConicalIcon} />
        </dl>
      </Panel>
      <Panel title={month === undefined ? words.title : fill(summary.fairness, { month: format.month(month) })}>
        {fairness.length === 0 ? (
          <p className="text-sm text-muted-foreground">{summary.noFairness}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-4">
            {fairness.map((row) => {
              const figures = `${fill(words.given, { amount: format.money(row.givenCents) })}, ${fill(words.agreed, { amount: format.money(row.agreedCents) })}`;
              const amount = format.money(Math.abs(row.positionCents));
              const status = row.positionCents > 0 ? fill(words.owed, { name: row.member, amount }) : row.positionCents < 0 ? fill(words.owes, { name: row.member, amount }) : fill(words.even, { name: row.member });
              return (
                <li key={row.member} className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
                      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${shareColorAt(row.shareIndex).dot}`} />
                      <span className="break-words">{row.member}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">{figures}</span>
                  </div>
                  <MeterBar value={row.givenCents} max={max} target={row.agreedCents} fill={shareColorAt(row.shareIndex).fill} label={`${row.member}: ${figures}`} className="mt-2" />
                  <p className="mt-1 text-sm text-muted-foreground">{status}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title={widgets.verified.title} description={widgets.verified.description}>
        {totals.verified.length === 0 ? (
          <p className="text-sm text-muted-foreground">{widgets.verified.none}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2 text-sm">
            {totals.verified.map((entry) => (
              <li key={entry.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                <code className="min-w-0 font-mono text-xs break-all">{entry.paypalId}</code>
                <span className="tabular-nums">
                  {format.day(entry.day)} · {format.money(entry.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
