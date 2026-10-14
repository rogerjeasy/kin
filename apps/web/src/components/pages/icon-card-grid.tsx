import { cn } from "@/lib/utils";

import { IconCard, type IconCardContent } from "./icon-card";

const layouts = {
  two: "sm:grid-cols-2",
  three: "sm:grid-cols-2 lg:grid-cols-3",
} as const;

type IconCardGridProps = {
  items: readonly IconCardContent[];
  columns?: keyof typeof layouts;
  /** The heading level of each card, one below the section's own heading. */
  as?: "h2" | "h3";
};

export function IconCardGrid({ items, columns = "three", as = "h3" }: IconCardGridProps) {
  return (
    <ul className={cn("grid gap-4 lg:gap-6", layouts[columns])}>
      {items.map((item) => (
        <IconCard key={item.title} as={as} {...item} />
      ))}
    </ul>
  );
}
