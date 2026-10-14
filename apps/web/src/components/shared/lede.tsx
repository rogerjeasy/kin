import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type LedeProps = { className?: string; children: ReactNode };

/** The paragraph that follows a heading. */
export function Lede({ className, children }: LedeProps) {
  return <p className={cn("max-w-xl text-lede text-muted-foreground", className)}>{children}</p>;
}
