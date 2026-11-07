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
      <ul className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <li key={row.memberId} className="min-w-0 rounded-xl border p-4">
            <h3 className="font-semibold wrap-anywhere">{row.name}</h3>
            <table className="mt-3 w-full table-fixed text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <td className="w-2/5" />
                  <th scope="col" className="px-1 text-end font-medium">{nowLabel}</th>
                  <th scope="col" className="ps-1 text-end font-medium">{simulatedLabel}</th>
                </tr>
              </thead>
              <tbody>
                {row.lines.map((line) => (
                  <tr key={line.label}>
                    <th scope="row" className="py-1 pe-2 text-start font-normal text-muted-foreground wrap-anywhere">{line.label}</th>
                    <td className="px-1 py-1 text-end tabular-nums wrap-anywhere">{line.now}</td>
                    <td className={`ps-1 py-1 text-end tabular-nums wrap-anywhere ${line.changed ? "font-semibold" : ""}`}>{line.simulated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 border-t pt-3 text-sm">
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
