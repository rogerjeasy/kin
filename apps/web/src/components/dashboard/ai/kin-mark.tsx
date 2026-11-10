import { cn } from "@/lib/utils";

type Props = {
  /** Kin is working: the light breathes and a ring rises from it. */
  active?: boolean;
  size?: "sm" | "lg";
  className?: string;
};

/** Kin's mark in a conversation: a small ink disc holding a point of gold light. Decorative. */
export function KinMark({ active = false, size = "sm", className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full bg-band ring-1 ring-band-border shadow-[0_0_18px_-4px_rgb(var(--glow-gold)/0.65)]",
        size === "sm" ? "size-9" : "size-16",
        active && "motion-safe:animate-glow-pulse",
        className,
      )}
    >
      {active ? <span className="absolute inset-1 rounded-full ring-1 ring-gold/60 motion-safe:animate-dot-ping" /> : null}
      <span className={cn("rounded-full bg-gold shadow-[0_0_10px_3px_rgb(var(--glow-gold)/0.75)]", size === "sm" ? "size-2.5" : "size-4")} />
    </span>
  );
}
