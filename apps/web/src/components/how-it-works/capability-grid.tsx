import type { Dictionary } from "@/i18n/dictionary";

type CapabilityGridProps = { copy: Dictionary["howItWorks"]["paypal"] };

/**
 * Each PayPal capability beside the family need it answers. The hairlines are
 * the list's own colour showing through the gaps, so the last card widens on a
 * two-column screen to leave no empty cell.
 */
export function CapabilityGrid({ copy }: CapabilityGridProps) {
  return (
    <ul className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {copy.rows.map((row, index) => (
        <li key={row.need} className="min-w-0 bg-card p-6 sm:p-7 sm:last:col-span-2 lg:last:col-span-1">
          <span aria-hidden="true" className="font-mono text-sm font-medium text-highlight tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-3 font-serif text-2xl wrap-break-word">
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
