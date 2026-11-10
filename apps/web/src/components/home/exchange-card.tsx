import { SpokenLines, type SpokenLine } from "@/components/shared/spoken-lines";

type ExchangeCardProps = { label: string; lines: readonly SpokenLine[] };

const BARS = [40, 75, 55, 100, 65, 85, 45] as const;

/** One thing Rose can do by voice, shown as a call: who said what. */
export function ExchangeCard({ label, lines }: ExchangeCardProps) {
  return (
    <article className="glow-edge lift min-w-0 rounded-3xl border border-foreground/10 bg-foreground/[0.04] p-5 backdrop-blur-md sm:p-6 lg:even:-translate-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono text-xs font-medium text-highlight uppercase ltr:tracking-widest">{label}</h3>
        <svg viewBox="0 0 26 12" aria-hidden="true" className="wave-bars h-3 w-6.5 shrink-0">
          {BARS.map((height, index) => (
            <rect key={index} x={index * 4} y={(12 - (12 * height) / 100) / 2} width="2" height={(12 * height) / 100} rx="1" className="fill-gold" />
          ))}
        </svg>
      </div>
      <div className="mt-5">
        <SpokenLines lines={lines} />
      </div>
    </article>
  );
}
