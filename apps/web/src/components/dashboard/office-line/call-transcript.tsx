import type { TranscriptTurn } from "@kin/db";

import { KinMark } from "@/components/dashboard/ai/kin-mark";
import { cn } from "@/lib/utils";

type Props = {
  turns: readonly TranscriptTurn[];
  labels: { kin: string; caller: string; title: string };
};

/** A call as written down: Kin on one side, the caller on the other, each line labelled so side is never shown by position alone. */
export function CallTranscript({ turns, labels }: Props) {
  return (
    <ol aria-label={labels.title} className="enter-stagger min-w-0 space-y-3">
      {turns.map((turn, index) => {
        const kin = turn.from === "kin";
        return (
          <li key={index} className={cn("flex min-w-0 items-end gap-2.5", kin ? "justify-start" : "justify-end")}>
            {kin ? <KinMark className="size-7" /> : null}
            <p className={cn("min-w-0 max-w-[85%] rounded-3xl px-4 py-2.5 text-sm wrap-anywhere", kin ? "rounded-es-md border bg-card shadow-xs" : "rounded-ee-md bg-secondary")}>
              <span className={cn("mb-0.5 block text-xs font-semibold tracking-wide", kin ? "text-highlight" : "text-muted-foreground")}>{kin ? labels.kin : labels.caller}</span>
              {turn.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
