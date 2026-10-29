import { Panel } from "@/components/dashboard/ui/panel";

/** What the thresholds mean for bills of a few telling sizes. */
export function ApprovalExamples({ title, description, items }: { title: string; description: string; items: readonly { amount: string; words: string }[] }) {
  return (
    <Panel title={title} description={description}>
      <dl className="divide-y">
        {items.map((item) => (
          <div key={item.amount} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
            <dt className="tabular-nums text-muted-foreground">{item.amount}</dt>
            <dd className="min-w-0 font-medium wrap-anywhere">{item.words}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
