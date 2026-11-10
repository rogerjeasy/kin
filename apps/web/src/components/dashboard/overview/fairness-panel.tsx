import { GivenBars, type GivenRow } from "@/components/dashboard/ui/given-bars";
import { Panel } from "@/components/dashboard/ui/panel";
import { RisingFigure } from "@/components/motion/rising-figure";

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
        <dl className="grid grid-cols-1 divide-y overflow-hidden rounded-2xl border bg-muted sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
          {totals.map((total) => (
            <div key={total.label} className="min-w-0 p-4">
              <dt className="text-sm text-muted-foreground">{total.label}</dt>
              <dd className="mt-1 font-serif text-2xl tracking-tight tabular-nums">
                <RisingFigure value={total.value} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
