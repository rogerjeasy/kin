import type { Dictionary } from "@/i18n/dictionary";

type CapabilityGridProps = { copy: Dictionary["howItWorks"]["paypal"] };

/**
 * Each PayPal capability beside the family need it answers, as a grid of lit
 * cards. The last card widens on a two-column screen to leave no empty cell.
 */
export function CapabilityGrid({ copy }: CapabilityGridProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
      {copy.rows.map((row, index) => (
        <li key={row.need} className="group surface lift glow-edge min-w-0 rounded-3xl p-6 sm:p-7 sm:last:col-span-2 lg:last:col-span-1">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-full border border-gold/50 bg-gold/10 font-mono text-xs font-medium text-highlight tabular-nums transition-shadow duration-500 group-hover:shadow-[0_0_16px_2px_rgb(var(--glow-gold)/0.45)]">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-5 font-serif text-2xl wrap-break-word">
            <span className="sr-only">{copy.capabilityHeader}: </span>
            {row.capability}
          </h3>
          <p className="mt-2 text-muted-foreground">
            <span className="sr-only">{copy.needHeader}: </span>
            {row.need}
          </p>
        </li>
      ))}
    </ul>
  );
}
