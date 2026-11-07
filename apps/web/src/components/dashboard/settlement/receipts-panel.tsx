import type { ReactNode } from "react";

import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

export type ReceiptItem = {
  id: string;
  title: string;
  detail: string;
  amount: string;
  stateText: string;
  tone: PillTone;
  /** The buttons that decide on it, or a sentence saying who does. */
  actions: ReactNode;
};

type Props = { title: string; description: string; empty: string; items: readonly ReceiptItem[]; form: ReactNode };

/** The receipts members filed, each with where it stands, and the form to file another. */
export function ReceiptsPanel({ title, description, empty, items, form }: Props) {
  return (
    <Panel title={title} description={description}>
      <div className="grid min-w-0 gap-5">
        {items.length === 0 ? (
          <EmptyState text={empty} />
        ) : (
          <ul className="divide-y rounded-xl border">
            {items.map((item) => (
              <li key={item.id} className="grid min-w-0 gap-3 p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-pretty break-words">{item.title}</p>
                    <p className="text-sm text-pretty break-words text-muted-foreground">{item.detail}</p>
                  </div>
                  <span className="text-lg font-semibold whitespace-nowrap tabular-nums">{item.amount}</span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <StatusPill tone={item.tone}>{item.stateText}</StatusPill>
                  {item.actions}
                </div>
              </li>
            ))}
          </ul>
        )}
        {form}
      </div>
    </Panel>
  );
}
