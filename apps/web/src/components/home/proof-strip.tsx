import type { Dictionary } from "@/i18n/dictionary";

type ProofStripProps = { copy: Dictionary["home"]["proof"] };

/** Three published figures on the size of the problem, each with its source. */
export function ProofStrip({ copy }: ProofStripProps) {
  return (
    <section aria-label={copy.label} className="border-y">
      <ul className="mx-auto grid max-w-7xl divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        {copy.items.map((item) => (
          <li key={item.value} className="min-w-0 px-5 py-7 sm:px-8 lg:px-14">
            <p className="font-serif text-figure ltr:tracking-tight">{item.value}</p>
            <p className="mt-1.5">{item.text}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{item.source}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
