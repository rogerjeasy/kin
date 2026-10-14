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

/** Short titled points in a grid, each under a hairline. */
export function FeatureList({ items, columns = "two", as: Title = "h3" }: FeatureListProps) {
  return (
    <ul className={cn("grid gap-x-10", layouts[columns])}>
      {items.map((item) => (
        <li key={item.title} className="min-w-0 border-t py-5">
          <Title className="text-lg font-semibold">{item.title}</Title>
          <p className="mt-1 text-muted-foreground">{item.text}</p>
        </li>
      ))}
    </ul>
  );
}
