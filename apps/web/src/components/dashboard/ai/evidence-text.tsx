import { highlightSegments, type Highlight } from "@kin/documents";

import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  /** The words the answer was read from, as the person gave them. */
  text: string;
  /** The words the answer says it came from, each with the field it stands for. */
  highlights: readonly Highlight[];
  copy: Dictionary["aiProvenance"]["evidence"];
};

/**
 * The original words with the quoted evidence marked. A mark is underlined as
 * well as shaded, so it never depends on colour alone.
 */
export function EvidenceText({ text, highlights, copy }: Props) {
  const { segments } = highlightSegments(text, highlights);
  return (
    <figure className="min-w-0 space-y-1">
      <figcaption className="text-xs font-semibold text-muted-foreground">{copy.textTitle}</figcaption>
      <blockquote className="rounded-lg border bg-background p-3 text-sm wrap-anywhere whitespace-pre-wrap">
        {segments.map((segment, at) =>
          segment.ids.length === 0 ? (
            <span key={at}>{segment.text}</span>
          ) : (
            <mark key={at} className="rounded-sm bg-highlight/20 px-0.5 font-semibold text-foreground underline decoration-highlight decoration-2 underline-offset-4">
              {segment.text}
            </mark>
          ),
        )}
      </blockquote>
      <p className="text-xs text-muted-foreground">{copy.markedNote}</p>
    </figure>
  );
}
