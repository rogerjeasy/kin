import { cn } from "@/lib/utils";

import { RichText } from "./rich-text";
import { SpokenAmount } from "./spoken-amount";

export type SpokenLine = {
  /** The speaker's name, as shown. */
  speaker: string;
  text: string;
  /** Kin's lines are set upright, a person's in italics. */
  voice: "kin" | "person";
  /** The spoken amount that fills the line's {amount} slot, if it has one. */
  amount?: string;
};

const tones = {
  page: { speaker: "text-muted-foreground" },
  band: { speaker: "text-band-muted" },
} as const;

type SpokenLinesProps = { lines: readonly SpokenLine[]; tone?: keyof typeof tones };

/**
 * A short exchange drawn as a conversation: the person's words on one side,
 * Kin's on the other in a bubble edged with gold. Each line keeps the name of
 * who said it.
 */
export function SpokenLines({ lines, tone = "page" }: SpokenLinesProps) {
  return (
    <dl className="space-y-4">
      {lines.map((line) => {
        const kin = line.voice === "kin";
        return (
          <div key={line.text} className={cn("flex min-w-0 flex-col", kin ? "items-end" : "items-start")}>
            <dt className={cn("inline-flex items-center gap-2 px-1 text-sm font-medium", tones[tone].speaker)}>
              {kin ? <span aria-hidden="true" className="size-1.5 rounded-full bg-gold shadow-[0_0_8px_1px_rgb(var(--glow-gold)/0.7)]" /> : null}
              {line.speaker}
            </dt>
            <dd
              className={cn(
                "mt-1.5 max-w-[94%] min-w-0 rounded-3xl px-4 py-3 font-serif",
                kin
                  ? "rounded-se-md border border-gold/40 bg-card text-xl leading-normal shadow-[0_8px_30px_-12px_rgb(var(--glow-gold)/0.45)]"
                  : "rounded-ss-md bg-secondary text-2xl leading-snug ltr:italic",
              )}
            >
              <RichText
                template={line.text}
                slots={{ amount: line.amount ? <SpokenAmount tone={tone}>{line.amount}</SpokenAmount> : null }}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
