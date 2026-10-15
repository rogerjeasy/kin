import { MeterBar } from "@/components/dashboard/ui/meter-bar";
import { Panel } from "@/components/dashboard/ui/panel";

export type SpendingRow = { category: string; name: string; cents: number; amount: string };

type SpendingPanelProps = {
  title: string;
  description: string;
  total: string;
  rows: readonly SpendingRow[];
  className?: string;
};

/** The month's spending by category, largest first, on one scale. */
export function SpendingPanel({ title, description, total, rows, className }: SpendingPanelProps) {
  const max = Math.max(...rows.map((row) => row.cents));

  return (
    <Panel title={title} description={description} className={className}>
      <p className="text-2xl font-semibold tabular-nums">{total}</p>
      <ul className="mt-5 space-y-4">
        {rows.map((row) => (
          <li key={row.category}>
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <span className="tabular-nums">{row.amount}</span>
            </p>
            <MeterBar value={row.cents} max={max} fill="fill-primary" label={`${row.name}: ${row.amount}`} className="mt-2 h-2" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
