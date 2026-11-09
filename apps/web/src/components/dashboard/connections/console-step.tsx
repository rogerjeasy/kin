import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, LoaderCircleIcon, OctagonXIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";

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

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** One step of the live console: what the assistant did, what Kin answered, and the raw JSON-RPC behind it. */
export function ConsoleStep({ index, title, state, copy, exchanges, children }: Props) {
  const { tone, icon } = LOOK[state];
  return (
    <li className="min-w-0 rounded-xl border bg-background p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold tabular-nums">
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
                  <pre dir="ltr" className="mt-1 max-h-72 min-w-0 overflow-y-auto rounded-lg bg-secondary p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
                    {pretty(exchange.request)}
                  </pre>
                </figure>
                <figure className="min-w-0">
                  <figcaption className="text-xs font-semibold text-muted-foreground uppercase">
                    {copy.response} · HTTP {exchange.status}
                  </figcaption>
                  <pre dir="ltr" className="mt-1 max-h-72 min-w-0 overflow-y-auto rounded-lg bg-secondary p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
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
