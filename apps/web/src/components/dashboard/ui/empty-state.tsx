import { InboxIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = { text: string; title?: string; icon?: LucideIcon; className?: string };

/** What a region says when it has nothing to show yet, and why. */
export function EmptyState({ text, title, icon: Icon = InboxIcon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-dashed bg-muted/40 p-4 text-sm", className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <p className="text-pretty text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
