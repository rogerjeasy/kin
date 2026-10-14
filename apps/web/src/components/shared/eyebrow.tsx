import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EyebrowProps = { className?: string; children: ReactNode };

/** The small label above a heading. */
export function Eyebrow({ className, children }: EyebrowProps) {
  return (
    <p className={cn("text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest", className)}>
      {children}
    </p>
  );
}
