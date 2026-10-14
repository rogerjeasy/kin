import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ContainerProps = { className?: string; children: ReactNode };

/** The page's column: centred, with the same side padding everywhere. */
export function Container({ className, children }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-14", className)}>
      {children}
    </div>
  );
}
