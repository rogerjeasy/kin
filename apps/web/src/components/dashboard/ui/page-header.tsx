import type { ReactNode } from "react";

import { Heading } from "@/components/shared/heading";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  lede: string;
  /** The screen's main actions, beside the title on a wide screen. */
  actions?: ReactNode;
};

/** The top of a circle screen: where you are and what this screen is for. */
export function PageHeader({ eyebrow, title, lede, actions }: PageHeaderProps) {
  return (
    <div className="enter-stagger flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <p className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-gold shadow-[0_0_10px_2px_rgb(var(--glow-gold)/0.6)]" />
            {eyebrow}
          </p>
        ) : null}
        <Heading as="h1" size="title" className="mt-2">
          {title}
        </Heading>
        <p className="mt-3 text-lede text-pretty text-muted-foreground">{lede}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
