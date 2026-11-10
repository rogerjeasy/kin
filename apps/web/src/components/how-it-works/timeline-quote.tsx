import amara from "@/assets/images/amara.jpg";
import { KnotMark } from "@/components/brand/knot-mark";
import { Avatar } from "@/components/shared/avatar";
import { Waveform } from "@/components/shared/waveform";
import { cn } from "@/lib/utils";

type TimelineQuoteProps = {
  /** Kin's lines are set upright with a waveform, a person's in italics. */
  voice: "kin" | "amara";
  speaker: string;
  quote: string;
};

/** What was said that day, under the name and face of who said it. */
export function TimelineQuote({ voice, speaker, quote }: TimelineQuoteProps) {
  const isKin = voice === "kin";

  return (
    <figure className={cn("surface mt-5 rounded-3xl p-5 shadow-md", isKin && "border-gold/40")}>
      <figcaption className="flex items-center gap-3">
        {isKin ? (
          <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
            <KnotMark className="size-6" />
          </span>
        ) : (
          <Avatar src={amara} size="sm" />
        )}
        <span className="text-sm font-medium text-muted-foreground">{speaker}</span>
        {isKin ? <Waveform /> : null}
      </figcaption>
      <blockquote className={cn("mt-3 font-serif text-speech", !isKin && "ltr:italic")}>{quote}</blockquote>
    </figure>
  );
}
