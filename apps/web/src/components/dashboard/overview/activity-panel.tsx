import { FlowAmount } from "@/components/dashboard/ui/flow-amount";
import { Panel } from "@/components/dashboard/ui/panel";

export type ActivityItem = {
  id: string;
  day: string;
  text: string;
  kind: string;
  amount: string;
  flow: "in" | "out" | "none";
  /** No real sandbox transaction stands behind it (AGENTS.md section 5, rule 9). */
  simulated: boolean;
  /** Says a real PayPal sandbox transaction stands behind it, or `null` for simulated history. */
  tag: string | null;
};

type ActivityPanelProps = {
  title: string;
  link: { href: string; label: string };
  items: readonly ActivityItem[];
  className?: string;
};

/** The newest entries in the record. */
export function ActivityPanel({ title, link, items, className }: ActivityPanelProps) {
  return (
    <Panel title={title} link={link} flush className={className}>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-3.5 sm:gap-x-4 sm:px-6">
            <span className="text-sm text-muted-foreground tabular-nums">{item.day}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">{item.text}</p>
              <p className="truncate text-sm text-muted-foreground">
                {item.kind}
                {item.tag === null ? null : <span className="font-medium text-highlight"> · {item.tag}</span>}
              </p>
            </div>
            <FlowAmount amount={item.amount} flow={item.flow} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
