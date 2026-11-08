"use client";

import { ChevronDownIcon, FlaskConicalIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DemoBannerFrameProps = {
  /** "Demo circle". */
  label: string;
  /** The role switcher: always on the first line, so a visitor can change seat without opening anything. */
  switcher: ReactNode;
  /** What the demo is, and its simulated history. */
  explanation: ReactNode;
  /** Start again and Leave. */
  actions: ReactNode;
};

/**
 * The demo banner's layout. From the `sm` width up it shows everything at
 * once. On a phone it is one line, the label and the role switcher, and the
 * label opens the explanation and the actions, so the banner does not take
 * half the first screen. The words stay in the page when closed only from
 * `sm` up; on a phone they are removed from view and from the accessibility
 * tree until opened.
 */
export function DemoBannerFrame({ label, switcher, explanation, actions }: DemoBannerFrameProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const shown = open ? "flex" : "hidden sm:flex";
  return (
    <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-highlight/25 bg-highlight/8 px-3 py-1 text-sm sm:px-4 sm:py-3">
      <FlaskConicalIcon aria-hidden="true" className="size-4 shrink-0 text-highlight sm:hidden" />
      <Button type="button" variant="ghost" size="sm" className="order-1 min-h-11 gap-1 px-2 font-semibold sm:hidden" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
        {label}
        <ChevronDownIcon aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </Button>
      <strong className="order-1 hidden items-center gap-2 font-semibold sm:flex">
        <FlaskConicalIcon aria-hidden="true" className="size-4 shrink-0 text-highlight" />
        {label}
      </strong>
      <div className="order-2 min-w-0 flex-1 sm:flex-none">{switcher}</div>
      <div id={detailsId} className="order-3 contents">
        <p className={cn("order-4 basis-full py-1 text-muted-foreground sm:order-5", open ? "block" : "hidden sm:block")}>{explanation}</p>
        <div className={cn("order-5 flex-wrap items-center gap-2 sm:order-3", shown)}>{actions}</div>
      </div>
    </div>
  );
}
