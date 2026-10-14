import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const tones = {
  page: "bg-secondary text-highlight",
  band: "bg-band-border text-band-highlight",
} as const;

type IconBadgeProps = { icon: LucideIcon; tone?: keyof typeof tones; className?: string };

/** A small round holder for an icon. Decorative: the words beside it carry the meaning. */
export function IconBadge({ icon: Icon, tone = "page", className }: IconBadgeProps) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full", tones[tone], className)}>
      <Icon className="size-5" />
    </span>
  );
}
