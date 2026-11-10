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

/** One point with an icon, in its own lit card. */
export function IconCard({ icon, title, text, label, as: Title }: IconCardProps) {
  return (
    <li className="group surface lift glow-edge min-w-0 rounded-3xl p-6 sm:p-7">
      <IconBadge
        icon={icon}
        className="border border-gold/40 shadow-[0_0_18px_-2px_rgb(var(--glow-gold)/0.45)] transition-transform duration-500 ease-(--ease-spring) motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-6"
      />
      {label ? <p className="mt-6 text-sm font-medium text-muted-foreground">{label}</p> : null}
      <Title className={label ? "mt-1 text-lg font-semibold" : "mt-6 text-lg font-semibold"}>{title}</Title>
      <p className="mt-1.5 text-muted-foreground">{text}</p>
    </li>
  );
}
