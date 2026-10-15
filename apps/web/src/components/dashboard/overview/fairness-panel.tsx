import { GivenBars, type GivenRow } from "@/components/dashboard/ui/given-bars";
import { Panel } from "@/components/dashboard/ui/panel";

type FairnessPanelProps = {
  title: string;
  description: string;
  link: { href: string; label: string };
  rows: readonly GivenRow[];
  /** The settlement's totals, under the bars. */
  totals: readonly { label: string; value: string }[];
  className?: string;
};

/** Each sibling against their agreed share, and what the settlement will move. */
export function FairnessPanel({ title, description, link, rows, totals, className }: FairnessPanelProps) {
  return (
    <Panel title={title} description={description} link={link} className={className}>
      <div className="flex h-full flex-col justify-between gap-6">
        <GivenBars rows={rows} />
        <dl className="grid grid-cols-1 gap-3 rounded-xl bg-muted p-4 sm:grid-cols-3">
          {totals.map((total) => (
            <div key={total.label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{total.label}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{total.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
