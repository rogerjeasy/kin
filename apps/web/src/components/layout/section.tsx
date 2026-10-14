import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Container } from "./container";

const tones = {
  plain: "",
  muted: "bg-muted",
  band: "bg-band text-band-foreground",
} as const;

type SectionProps = {
  tone?: keyof typeof tones;
  /** The id of the heading that names this section. */
  labelledBy?: string;
  className?: string;
  children: ReactNode;
};

export function Section({ tone = "plain", labelledBy, className, children }: SectionProps) {
  return (
    <section aria-labelledby={labelledBy} className={cn("py-16 sm:py-20 lg:py-28", tones[tone], className)}>
      <Container>{children}</Container>
    </section>
  );
}
