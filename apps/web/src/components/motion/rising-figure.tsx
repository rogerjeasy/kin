import { cn } from "@/lib/utils";

type RisingFigureProps = { value: string; className?: string };

/**
 * A figure whose characters rise into place one after another. The text is
 * the formatted value itself, split only into spans, so it reads, copies and
 * matches exactly as the plain string does. Pure CSS (`rise-chars`): it plays
 * on first paint, and not at all for a reader who asks for reduced motion.
 */
export function RisingFigure({ value, className }: RisingFigureProps) {
  return (
    <span className={cn("rise-chars", className)}>
      {Array.from(value).map((character, index) => (
        <span key={index}>{character}</span>
      ))}
    </span>
  );
}
