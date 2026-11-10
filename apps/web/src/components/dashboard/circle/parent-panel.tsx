import { CheckIcon } from "lucide-react";

import { MemberAvatar } from "@/components/dashboard/ui/member-avatar";
import { cn } from "@/lib/utils";

type Level = { key: string; title: string; text: string; current: boolean };

type ParentPanelProps = {
  portrait: string | null;
  name: string;
  title: string;
  text: string;
  levelsLabel: string;
  currentLabel: string;
  levels: readonly Level[];
  className?: string;
};

/** How the parent takes part: the level chosen with them, beside the other two. */
export function ParentPanel({ portrait, name, title, text, levelsLabel, currentLabel, levels, className }: ParentPanelProps) {
  return (
    <section aria-labelledby="parent-heading" className={cn("surface rounded-3xl p-5 sm:p-6", className)}>
      <div className="flex items-center gap-4">
        <MemberAvatar portrait={portrait} name={name} size="lg" className="size-16 ring-2 ring-gold/60 ring-offset-2 ring-offset-card shadow-[0_0_24px_-6px_rgb(var(--glow-gold)/0.8)]" />
        <h2 id="parent-heading" className="font-serif text-subtitle text-balance">
          {title}
        </h2>
      </div>
      <p className="mt-4 text-pretty">{text}</p>
      <h3 className="mt-6 text-sm font-semibold text-muted-foreground">{levelsLabel}</h3>
      <ul className="mt-3 space-y-2">
        {levels.map((level) => (
          <li key={level.key} className={cn("rounded-2xl border p-3.5 transition-colors", level.current ? "border-gold/60 bg-highlight/10 shadow-[0_0_28px_-14px_rgb(var(--glow-gold)/0.9)]" : "border-dashed")}>
            <p className="flex flex-wrap items-center justify-between gap-2 font-medium">
              {level.title}
              {level.current ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-highlight ring-1 ring-gold/40">
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                  {currentLabel}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{level.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
