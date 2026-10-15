import { CheckIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import { Tag } from "@/components/shared/tag";

export type DecidedItem = { id: string; day: string; text: string; kind: string; amount: string; simulated: boolean };

type DecidedListProps = { title: string; description: string; simulated: string; items: readonly DecidedItem[] };

/** The month's approvals, each kept with the ledger entry it led to. */
export function DecidedList({ title, description, simulated, items }: DecidedListProps) {
  return (
    <Panel title={title} description={description} flush>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-3.5 sm:gap-x-4 sm:px-6">
            <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-positive/10 text-positive">
              <CheckIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-pretty">{item.text}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>{item.day}</span>
                <span aria-hidden="true">·</span>
                <span>{item.kind}</span>
                {item.simulated ? <Tag className="py-0.5">{simulated}</Tag> : null}
              </p>
            </div>
            <span className="font-semibold whitespace-nowrap tabular-nums">{item.amount}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
