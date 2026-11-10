import { cn } from "@/lib/utils";

type Props = { left: number; total: number; label: string };

/**
 * How many of the demo's questions are left, in words and as a row of
 * lights, one per question. The words carry it; the lights are decoration.
 */
export function DemoQuestionsLeft({ left, total, label }: Props) {
  return (
    <p role="status" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-highlight/30 bg-highlight/8 px-4 py-3 text-sm font-medium">
      <span aria-hidden="true" className="flex shrink-0 gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-2.5 rounded-full transition-colors duration-500",
              index < left ? "bg-gold shadow-[0_0_8px_1px_rgb(var(--glow-gold)/0.55)]" : "bg-border",
            )}
          />
        ))}
      </span>
      <span className="min-w-0">{label}</span>
    </p>
  );
}
