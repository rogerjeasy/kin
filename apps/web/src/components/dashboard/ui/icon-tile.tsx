import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** A square holder for an icon at the start of a row. Decorative. */
export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground", className)}>
      <Icon className="size-5" />
    </span>
  );
}
