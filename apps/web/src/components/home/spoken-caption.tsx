import { RichText } from "@/components/shared/rich-text";
import { SpokenAmount } from "@/components/shared/spoken-amount";
import { Waveform } from "@/components/shared/waveform";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { cn } from "@/lib/utils";

import { SpeakButton } from "./speak-button";

type SpokenCaptionProps = {
  locale: Locale;
  copy: Dictionary["home"]["hero"];
  className?: string;
};

/** The sentence Kin said to Rose, with a button that says it aloud. */
export function SpokenCaption({ locale, copy, className }: SpokenCaptionProps) {
  return (
    <figure className={cn("rounded-3xl bg-card p-5", className)}>
      <div className="flex items-center gap-3">
        <SpeakButton
          text={fill(copy.spoken, { amount: copy.spokenAmount })}
          lang={locale}
          playLabel={copy.play}
          stopLabel={copy.stop}
        />
        <figcaption className="text-xs font-medium whitespace-nowrap text-muted-foreground uppercase ltr:tracking-wider">
          {copy.captionTime}
        </figcaption>
        <Waveform />
      </div>
      <blockquote className="mt-3 font-serif text-speech">
        <RichText template={copy.spoken} slots={{ amount: <SpokenAmount>{copy.spokenAmount}</SpokenAmount> }} />
      </blockquote>
    </figure>
  );
}
