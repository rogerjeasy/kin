import { cn } from "@/lib/utils";

const tones = {
  page: "text-highlight",
  band: "text-band-highlight",
} as const;

type SpokenAmountProps = { tone?: keyof typeof tones; children: string };

/** An amount inside a spoken sentence, picked out in gold and kept on one line. */
export function SpokenAmount({ tone = "page", children }: SpokenAmountProps) {
  return <mark className={cn("bg-transparent whitespace-nowrap ltr:italic", tones[tone])}>{children}</mark>;
}
