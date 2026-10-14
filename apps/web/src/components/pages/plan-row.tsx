type PlanRowProps = {
  name: string;
  /** Each detail carries its own label, shown on a phone where there is no table header. */
  details: readonly { label: string; value: string }[];
};

/**
 * One plan. A stacked card on a phone, a table row from lg up. The grid
 * columns here must match the header in plan-list.tsx.
 */
export function PlanRow({ name, details }: PlanRowProps) {
  return (
    <li className="grid gap-x-8 gap-y-3 border-t py-6 lg:grid-cols-[1fr_1.3fr_1.6fr_1.2fr] lg:items-baseline">
      <h3 className="font-serif text-2xl">{name}</h3>
      {details.map((detail) => (
        <p key={detail.label} className="min-w-0">
          <span className="block text-sm text-muted-foreground lg:sr-only">{detail.label}</span>
          {detail.value}
        </p>
      ))}
    </li>
  );
}
