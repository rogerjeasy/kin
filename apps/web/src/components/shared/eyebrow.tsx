import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EyebrowProps = { className?: string; children: ReactNode };

/** The small label above a heading, lit by a gold spark. */
export function Eyebrow({ className, children }: EyebrowProps) {
  return (
    <p className={cn("inline-flex items-center gap-2.5 text-sm font-medium text-muted-foreground uppercase ltr:tracking-[0.18em]", className)}>
      <span aria-hidden="true" className="h-px w-6 bg-linear-to-r from-transparent to-gold rtl:bg-linear-to-l" />
      {children}
    </p>
  );
}
