import { RisingFigure } from "@/components/motion/rising-figure";

type HeroFactsProps = { facts: readonly { value: string; label: string }[] };

/** The month in three figures, each rising into place under a line of gold. */
export function HeroFacts({ facts }: HeroFactsProps) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3 sm:max-w-xl">
      {facts.map((fact) => (
        <div key={fact.label} className="relative flex min-w-0 flex-col-reverse rounded-2xl border border-foreground/10 bg-foreground/[0.04] px-4 py-4 backdrop-blur-md">
          <span aria-hidden="true" className="absolute inset-x-4 top-0 h-px bg-linear-to-r from-transparent via-gold/70 to-transparent" />
          <dt className="text-sm text-muted-foreground">{fact.label}</dt>
          <dd className="font-serif text-figure text-highlight ltr:tracking-tight">
            <RisingFigure value={fact.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
