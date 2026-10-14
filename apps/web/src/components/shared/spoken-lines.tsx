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

/** A short exchange, each line under the name of who said it. */
export function SpokenLines({ lines, tone = "page" }: SpokenLinesProps) {
  return (
    <dl className="space-y-5">
      {lines.map((line) => (
        <div key={line.text}>
          <dt className={cn("text-sm font-medium", tones[tone].speaker)}>{line.speaker}</dt>
          <dd className={cn("mt-1 font-serif", line.voice === "person" ? "text-2xl leading-snug ltr:italic" : "text-xl leading-normal")}>
            <RichText
              template={line.text}
              slots={{ amount: line.amount ? <SpokenAmount tone={tone}>{line.amount}</SpokenAmount> : null }}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
