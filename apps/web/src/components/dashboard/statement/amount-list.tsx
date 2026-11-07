import { EmptyState } from "@/components/dashboard/ui/empty-state";

type AmountListProps = {
  /** A line without an amount says it in its label. */
  items: readonly { id: string; label: string; amount?: string }[];
  /** What to say when the list is empty. */
  empty: string;
  /** A total line under the list, when there is more than one item. */
  total?: { label: string; amount: string };
};

/** Names and amounts, one to a line, with a total. */
export function AmountList({ items, empty, total }: AmountListProps) {
  if (items.length === 0) return <EmptyState text={empty} />;
  return (
    <dl className="divide-y text-sm">
      {items.map((item) => (
        <div key={item.id} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0">
          <dt className="min-w-0 break-words">{item.label}</dt>
          {item.amount === undefined ? null : <dd className="shrink-0 font-semibold tabular-nums">{item.amount}</dd>}
        </div>
      ))}
      {total && items.length > 1 ? (
        <div className="flex items-baseline justify-between gap-4 pt-3 font-semibold">
          <dt className="min-w-0">{total.label}</dt>
          <dd className="shrink-0 tabular-nums">{total.amount}</dd>
        </div>
      ) : null}
    </dl>
  );
}
