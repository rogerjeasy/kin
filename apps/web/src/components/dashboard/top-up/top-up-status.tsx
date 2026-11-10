import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Tone = "working" | "done" | "problem";

const ICONS = { working: LoaderCircleIcon, done: CheckCircle2Icon, problem: CircleAlertIcon } as const;

/** Where the top-up stands, read out by screen readers as it changes. */
export function TopUpStatus({ tone, text }: { tone: Tone; text: string }) {
  const Icon = ICONS[tone];
  return (
    <p className={cn("enter flex min-w-0 items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 text-pretty shadow-xs", tone === "done" && "border-gold/60 shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.14),var(--shadow-sm)]")}>
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-5 shrink-0", tone === "working" && "animate-spin text-muted-foreground motion-reduce:animate-none", tone === "done" && "text-highlight", tone === "problem" && "text-destructive")}
      />
      <span className="min-w-0">{text}</span>
    </p>
  );
}
