import { Panel } from "@/components/dashboard/ui/panel";

export type ComingUpItem = { id: string; day: string; payee: string; approval: string; amount: string };

type ComingUpPanelProps = {
  title: string;
  link: { href: string; label: string };
  items: readonly ComingUpItem[];
  className?: string;
};

/** The next bills, with how each will be approved. */
export function ComingUpPanel({ title, link, items, className }: ComingUpPanelProps) {
  return (
    <Panel title={title} link={link} flush className={className}>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-3.5 sm:px-6">
            <span className="text-sm font-medium tabular-nums">{item.day}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">{item.payee}</p>
              <p className="text-sm text-muted-foreground">{item.approval}</p>
            </div>
            <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{item.amount}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
