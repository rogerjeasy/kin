import type { StaticImageData } from "next/image";
import { CheckIcon } from "lucide-react";

import { Avatar } from "@/components/shared/avatar";
import { cn } from "@/lib/utils";

type Level = { key: string; title: string; text: string; current: boolean };

type ParentPanelProps = {
  portrait: StaticImageData;
  title: string;
  text: string;
  levelsLabel: string;
  currentLabel: string;
  levels: readonly Level[];
  className?: string;
};

/** How the parent takes part: the level chosen with them, beside the other two. */
export function ParentPanel({ portrait, title, text, levelsLabel, currentLabel, levels, className }: ParentPanelProps) {
  return (
    <section aria-labelledby="parent-heading" className={cn("rounded-2xl border bg-card p-5 shadow-xs sm:p-6", className)}>
      <div className="flex items-center gap-4">
        <Avatar src={portrait} size="lg" className="size-16" />
        <h2 id="parent-heading" className="font-serif text-subtitle text-balance">
          {title}
        </h2>
      </div>
      <p className="mt-4 text-pretty">{text}</p>
      <h3 className="mt-6 text-sm font-semibold text-muted-foreground">{levelsLabel}</h3>
      <ul className="mt-3 space-y-2">
        {levels.map((level) => (
          <li key={level.key} className={cn("rounded-xl border p-3.5", level.current && "border-primary bg-secondary/60")}>
            <p className="flex flex-wrap items-center justify-between gap-2 font-medium">
              {level.title}
              {level.current ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold">
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
