import { cn } from "@/lib/utils";

type InitialsAvatarProps = { name: string; className?: string };

/** The first letters of a person's name, in a circle. Decorative: the name is always written nearby. */
export function InitialsAvatar({ name, className }: InitialsAvatarProps) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toLocaleUpperCase();

  return (
    <span aria-hidden="true" className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground", className)}>
      {initials}
    </span>
  );
}
