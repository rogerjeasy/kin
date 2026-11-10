import { Container } from "@/components/layout/container";
import { RisingFigure } from "@/components/motion/rising-figure";
import type { Dictionary } from "@/i18n/dictionary";

type ProofStripProps = { copy: Dictionary["home"]["proof"] };

/** Three published figures on the size of the problem, each with its source. */
export function ProofStrip({ copy }: ProofStripProps) {
  return (
    <section aria-label={copy.label} className="py-10 sm:py-14">
      <Container>
        <ul className="grid gap-4 md:grid-cols-3">
          {copy.items.map((item) => (
            <li key={item.value} className="surface lift reveal min-w-0 rounded-3xl p-6 sm:p-7">
              <p className="font-serif text-figure ltr:tracking-tight">
                <RisingFigure value={item.value} />
              </p>
              <span aria-hidden="true" className="mt-4 block h-px w-12 bg-linear-to-r from-gold to-transparent rtl:bg-linear-to-l" />
              <p className="mt-4">{item.text}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{item.source}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
