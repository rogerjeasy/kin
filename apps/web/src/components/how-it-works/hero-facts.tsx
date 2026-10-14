type HeroFactsProps = { facts: readonly { value: string; label: string }[] };

/** The month in three figures. */
export function HeroFacts({ facts }: HeroFactsProps) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t pt-6">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col-reverse">
          <dt className="text-sm text-muted-foreground">{fact.label}</dt>
          <dd className="font-serif text-figure ltr:tracking-tight">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
