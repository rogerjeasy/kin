type TimelineFactsProps = { facts: readonly { label: string; value: string }[] };

/** The two things every movement of money has: a yes, and a PayPal record. */
export function TimelineFacts({ facts }: TimelineFactsProps) {
  return (
    <dl className="mt-5 grid gap-x-8 gap-y-3 border-t pt-4 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="font-mono text-xs font-medium text-muted-foreground uppercase ltr:tracking-wider">{fact.label}</dt>
          <dd className="mt-1 font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
