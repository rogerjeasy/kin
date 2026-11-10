import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** A square holder for an icon at the start of a row. Decorative. */
export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-secondary text-foreground shadow-[inset_0_1px_0_rgb(var(--sheen)/0.6),inset_0_0_0_1px_var(--border)]",
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}
