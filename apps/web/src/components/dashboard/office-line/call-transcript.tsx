import type { TranscriptTurn } from "@kin/db";

import { cn } from "@/lib/utils";

type Props = {
  turns: readonly TranscriptTurn[];
  labels: { kin: string; caller: string; title: string };
};

/** A call as written down: Kin on one side, the caller on the other, each line labelled so side is never shown by position alone. */
export function CallTranscript({ turns, labels }: Props) {
  return (
    <ol aria-label={labels.title} className="min-w-0 space-y-2">
      {turns.map((turn, index) => (
        <li key={index} className={cn("flex min-w-0", turn.from === "kin" ? "justify-start" : "justify-end")}>
          <p className={cn("min-w-0 max-w-[85%] rounded-2xl px-4 py-2 text-sm wrap-anywhere", turn.from === "kin" ? "bg-secondary" : "bg-primary/10")}>
            <span className="block text-xs font-semibold text-muted-foreground">{turn.from === "kin" ? labels.kin : labels.caller}</span>
            {turn.text}
          </p>
        </li>
      ))}
    </ol>
  );
}
