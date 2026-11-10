import { Panel } from "@/components/dashboard/ui/panel";

export type ComparisonRow = {
  memberId: string;
  name: string;
  lines: readonly { label: string; now: string; simulated: string; changed: boolean }[];
  position: { now: string; simulated: string };
};

type Props = {
  title: string;
  nowLabel: string;
  simulatedLabel: string;
  rows: readonly ComparisonRow[];
};

/** Every member's share, agreed target and position, today and under the scenario, side by side. */
export function MemberComparison({ title, nowLabel, simulatedLabel, rows }: Props) {
  return (
    <Panel title={title}>
      <ul className="enter-stagger grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <li key={row.memberId} className="lift min-w-0 rounded-3xl border bg-card p-4 shadow-2xs sm:p-5">
            <h3 className="flex min-w-0 items-center gap-2.5 font-semibold wrap-anywhere">
              <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-serif text-base ring-1 ring-border">
                {Array.from(row.name)[0]}
              </span>
              <span className="min-w-0">{row.name}</span>
            </h3>
            <table className="mt-3 w-full table-fixed text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <td className="w-2/5" />
                  <th scope="col" className="px-1 text-end font-medium">{nowLabel}</th>
                  <th scope="col" className="rounded-t-lg bg-highlight/10 px-1.5 pt-1 text-end font-semibold text-highlight">{simulatedLabel}</th>
                </tr>
              </thead>
              <tbody>
                {row.lines.map((line) => (
                  <tr key={line.label}>
                    <th scope="row" className="py-1 pe-2 text-start font-normal text-muted-foreground wrap-anywhere">{line.label}</th>
                    <td className="px-1 py-1 text-end tabular-nums wrap-anywhere">{line.now}</td>
                    <td className={`bg-highlight/10 px-1.5 py-1 text-end tabular-nums wrap-anywhere ${line.changed ? "font-semibold text-highlight" : ""}`}>{line.simulated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 space-y-1 rounded-2xl bg-muted/70 p-3 text-sm ring-1 ring-inset ring-border">
              <p className="text-muted-foreground wrap-anywhere">
                <span className="font-medium">{nowLabel}:</span> {row.position.now}
              </p>
              <p className="wrap-anywhere">
                <span className="font-medium">{simulatedLabel}:</span> {row.position.simulated}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
