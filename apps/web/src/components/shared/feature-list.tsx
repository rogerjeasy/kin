import { cn } from "@/lib/utils";

type Feature = { title: string; text: string };

const layouts = {
  two: "sm:grid-cols-2",
  three: "sm:grid-cols-2 lg:grid-cols-3",
} as const;

type FeatureListProps = {
  items: readonly Feature[];
  columns?: keyof typeof layouts;
  /** The heading level of each item, one below the section's own heading. */
  as?: "h2" | "h3";
};

/** Short titled points, each in its own lit card under a line of gold. */
export function FeatureList({ items, columns = "two", as: Title = "h3" }: FeatureListProps) {
  return (
    <ul className={cn("grid gap-3 sm:gap-4", layouts[columns])}>
      {items.map((item, index) => (
        <li key={item.title} className="surface lift glow-edge min-w-0 rounded-3xl p-5 sm:p-6">
          <span aria-hidden="true" className="absolute inset-x-6 top-0 h-px bg-linear-to-r from-gold/80 via-gold/30 to-transparent rtl:bg-linear-to-l" />
          <span aria-hidden="true" className="font-mono text-xs font-medium text-highlight tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <Title className="mt-3 text-lg font-semibold">{item.title}</Title>
          <p className="mt-1 text-muted-foreground">{item.text}</p>
        </li>
      ))}
    </ul>
  );
}
