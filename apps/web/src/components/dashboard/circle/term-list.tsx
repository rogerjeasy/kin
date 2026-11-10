/** The terms of an agreement, as label and value. */
export function TermList({ terms }: { terms: readonly { label: string; value: string }[] }) {
  return (
    <dl className="divide-y">
      {terms.map((term) => (
        <div key={term.label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4">
          <dt className="text-sm text-muted-foreground">{term.label}</dt>
          <dd className="font-medium tabular-nums wrap-anywhere">{term.value}</dd>
        </div>
      ))}
    </dl>
  );
}
