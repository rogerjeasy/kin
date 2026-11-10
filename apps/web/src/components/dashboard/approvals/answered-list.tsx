import { CheckIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Panel } from "@/components/dashboard/ui/panel";

export type AnsweredItem = {
  id: string;
  title: string;
  kind: string;
  amount: string;
  /** Where it stands: approved, declined or expired, in words. */
  status: string;
  approved: boolean;
  /** Who answered, and how: "Rose said yes by phone · Marcus said yes". */
  answers: string;
  /** PayPal's record of the payment, when PayPal's sandbox made it. */
  proof?: ReactNode;
};

type AnsweredListProps = { title: string; description: string; items: readonly AnsweredItem[] };

/** Proposals the circle has decided, each with the answers that decided it. */
export function AnsweredList({ title, description, items }: AnsweredListProps) {
  return (
    <Panel title={title} description={description} flush>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li key={item.id} id={item.id} className="grid scroll-mt-24 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-5 py-4 transition-colors duration-300 hover:bg-muted/60 sm:gap-x-4 sm:px-6">
            <span
              aria-hidden="true"
              className={`mt-0.5 inline-flex size-8 items-center justify-center rounded-full ring-1 ring-inset ${item.approved ? "bg-positive/10 text-positive ring-positive/25" : "bg-danger/10 text-danger ring-danger/25"}`}
            >
              {item.approved ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-pretty">{item.title}</p>
              <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
                {item.kind} · {item.status}
              </p>
              {item.answers ? <p className="mt-1 text-sm text-pretty text-muted-foreground">{item.answers}</p> : null}
              {item.proof}
            </div>
            <span className="font-serif text-lg whitespace-nowrap tabular-nums">{item.amount}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
