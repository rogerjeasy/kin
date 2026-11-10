import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, LoaderCircleIcon, OctagonXIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

import type { Exchange } from "./mcp-console-client";

export type StepState = "waiting" | "running" | "done" | "refused" | "failed";

type Props = {
  index: number;
  title: string;
  state: StepState;
  copy: Dictionary["openKin"]["console"];
  exchanges: readonly Exchange[];
  children?: ReactNode;
};

const LOOK: Record<StepState, { tone: PillTone; icon: typeof CircleCheckIcon }> = {
  waiting: { tone: "neutral", icon: CircleDashedIcon },
  running: { tone: "waiting", icon: LoaderCircleIcon },
  done: { tone: "positive", icon: CircleCheckIcon },
  refused: { tone: "danger", icon: OctagonXIcon },
  failed: { tone: "danger", icon: CircleXIcon },
};

/** A step's number lights as the session reaches it. Decorative: the pill says the state in words. */
const NODE: Record<StepState, string> = {
  waiting: "bg-secondary text-muted-foreground ring-border",
  running: "bg-gold/20 text-highlight ring-gold/60 motion-safe:animate-glow-pulse",
  done: "bg-positive/15 text-positive ring-positive/40",
  refused: "bg-danger/15 text-danger ring-danger/40",
  failed: "bg-danger/15 text-danger ring-danger/40",
};

const NODE_RING: Record<StepState, string> = {
  waiting: "",
  running: "border-gold/60 shadow-[0_0_32px_-12px_rgb(var(--glow-gold)/0.9)]",
  done: "border-positive/30",
  refused: "border-danger/50 shadow-[0_0_32px_-14px_var(--danger)]",
  failed: "border-danger/40",
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** One step of the live console: what the assistant did, what Kin answered, and the raw JSON-RPC behind it. */
export function ConsoleStep({ index, title, state, copy, exchanges, children }: Props) {
  const { tone, icon } = LOOK[state];
  return (
    <li className={cn("min-w-0 rounded-2xl border bg-card/70 p-4 transition-[border-color,box-shadow] duration-500", NODE_RING[state])}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ring-1", NODE[state])}>
          {index}
        </span>
        <p className="min-w-0 flex-1 basis-48 font-semibold text-balance">{title}</p>
        <StatusPill tone={tone} icon={icon}>
          {copy.states[state]}
        </StatusPill>
      </div>
      {children ? <div className="mt-3 min-w-0 text-sm text-pretty">{children}</div> : null}
      {exchanges.length > 0 ? (
        <details className="group mt-3 min-w-0">
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{copy.raw}</summary>
          <div className="mt-2 grid min-w-0 gap-3">
            {exchanges.map((exchange, position) => (
              <div key={position} className="grid min-w-0 gap-2 lg:grid-cols-2">
                <figure className="min-w-0">
                  <figcaption className="text-xs font-semibold text-muted-foreground uppercase">{copy.request}</figcaption>
                  <pre dir="ltr" className="mt-1 max-h-72 min-w-0 overflow-y-auto rounded-xl bg-muted p-3 font-mono ring-1 ring-inset ring-border text-xs whitespace-pre-wrap wrap-anywhere">
                    {pretty(exchange.request)}
                  </pre>
                </figure>
                <figure className="min-w-0">
                  <figcaption className="text-xs font-semibold text-muted-foreground uppercase">
                    {copy.response} · HTTP {exchange.status}
                  </figcaption>
                  <pre dir="ltr" className="mt-1 max-h-72 min-w-0 overflow-y-auto rounded-xl bg-muted p-3 font-mono ring-1 ring-inset ring-border text-xs whitespace-pre-wrap wrap-anywhere">
                    {pretty(exchange.response)}
                  </pre>
                </figure>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </li>
  );
}
