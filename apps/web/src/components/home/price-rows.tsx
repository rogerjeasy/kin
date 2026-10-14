type PriceRowsProps = { rows: readonly { name: string; price: string }[] };

/** Who pays what, at a glance. The full table is on the pricing page. */
export function PriceRows({ rows }: PriceRowsProps) {
  return (
    <dl className="mt-5 border-t">
      {rows.map((row) => (
        <div key={row.name} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b py-3">
          <dt className="font-semibold">{row.name}</dt>
          <dd className="text-muted-foreground">{row.price}</dd>
        </div>
      ))}
    </dl>
  );
}
