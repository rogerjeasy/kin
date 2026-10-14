import type { LucideIcon } from "lucide-react";

import { IconBadge } from "@/components/shared/icon-badge";

export type IconCardContent = {
  icon: LucideIcon;
  title: string;
  text: string;
  /** A small label above the title, such as who the card is for. */
  label?: string;
};

type IconCardProps = IconCardContent & { as: "h2" | "h3" };

/** One point with an icon, in its own card. */
export function IconCard({ icon, title, text, label, as: Title }: IconCardProps) {
  return (
    <li className="min-w-0 rounded-3xl border bg-card p-6 sm:p-7">
      <IconBadge icon={icon} />
      {label ? <p className="mt-5 text-sm font-medium text-muted-foreground">{label}</p> : null}
      <Title className={label ? "mt-1 text-lg font-semibold" : "mt-5 text-lg font-semibold"}>{title}</Title>
      <p className="mt-1.5 text-muted-foreground">{text}</p>
    </li>
  );
}
