import { SpokenLines, type SpokenLine } from "@/components/shared/spoken-lines";

type ExchangeCardProps = { label: string; lines: readonly SpokenLine[] };

/** One thing Rose can do by voice, shown as what is said. */
export function ExchangeCard({ label, lines }: ExchangeCardProps) {
  return (
    <article className="min-w-0 border-t border-band-border py-7 lg:border-t-0 lg:border-s lg:px-8 lg:py-0 lg:first:border-s-0 lg:first:ps-0">
      <h3 className="font-mono text-xs font-medium text-band-highlight uppercase ltr:tracking-widest">{label}</h3>
      <div className="mt-5">
        <SpokenLines lines={lines} tone="band" />
      </div>
    </article>
  );
}
