type PriceRowsProps = { rows: readonly { name: string; price: string }[] };

/** Who pays what, at a glance. The full table is on the pricing page. */
export function PriceRows({ rows }: PriceRowsProps) {
  return (
    <dl className="mt-7 space-y-2">
      {rows.map((row, index) => (
        <div
          key={row.name}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl border bg-background/60 px-4 py-3.5"
        >
          <dt className="inline-flex items-center gap-2.5 font-semibold">
            <span aria-hidden="true" className={index === 0 ? "size-2 rounded-full bg-gold shadow-[0_0_8px_1px_rgb(var(--glow-gold)/0.7)]" : "size-2 rounded-full bg-input"} />
            {row.name}
          </dt>
          <dd className={index === 0 ? "font-serif text-xl text-highlight" : "text-muted-foreground"}>{row.price}</dd>
        </div>
      ))}
    </dl>
  );
}
