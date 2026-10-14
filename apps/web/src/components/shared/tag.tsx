import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TagProps = { className?: string; children: ReactNode };

/** A small pill, used to label example data and pending states. */
export function Tag({ className, children }: TagProps) {
  return (
    <span className={cn("inline-block rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground", className)}>
      {children}
    </span>
  );
}
