type TimelineFactsProps = { facts: readonly { label: string; value: string }[] };

/** The two things every movement of money has: a yes, and a PayPal record. */
export function TimelineFacts({ facts }: TimelineFactsProps) {
  return (
    <dl className="mt-5 grid gap-2 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 rounded-2xl border bg-card/60 px-4 py-3">
          <dt className="font-mono text-xs font-medium text-muted-foreground uppercase ltr:tracking-wider">{fact.label}</dt>
          <dd className="mt-1 font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
