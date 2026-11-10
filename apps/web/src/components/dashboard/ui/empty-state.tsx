import { InboxIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = { text: string; title?: string; icon?: LucideIcon; className?: string };

/** What a region says when it has nothing to show yet, and why. */
export function EmptyState({ text, title, icon: Icon = InboxIcon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex items-start gap-3.5 rounded-2xl border border-dashed bg-muted/50 p-4 text-sm", className)}>
      <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground shadow-xs ring-1 ring-border">
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 pt-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <p className="text-pretty text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
