"use client";

import { ChevronDownIcon, MapIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  titleId: string;
  title: string;
  /** "Show the steps" and "Hide the steps", for the phone's toggle. */
  toggle: { show: string; hide: string };
  /** The form that puts the guide away. */
  dismiss: ReactNode;
  /** The steps, as list items. */
  children: ReactNode;
};

/**
 * The guide's layout. From `sm` up the steps are always shown. On a phone the
 * guide is one line until opened, so it never pushes the screen's own content
 * below the fold.
 */
export function DemoGuideFrame({ titleId, title, toggle, dismiss, children }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <section aria-labelledby={titleId} className="surface rounded-2xl px-3 py-1 text-sm sm:px-4 sm:py-3">
      {/* Wraps rather than squeezes: at 200 percent text the toggle moves under the title instead of past the edge. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2">
        <MapIcon aria-hidden="true" className="size-4 shrink-0 text-highlight" />
        <h2 id={titleId} className="min-w-0 flex-1 basis-32 font-semibold text-pretty">
          {title}
        </h2>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1 px-2 sm:hidden" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
          {open ? toggle.hide : toggle.show}
          <ChevronDownIcon aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </Button>
        {dismiss}
      </div>
      {/* Columns as wide as the text needs, so enlarged text gets fewer columns instead of spilling out of five. */}
      <ol id={listId} className={cn("mt-1 mb-2 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2 sm:mt-2 sm:mb-0 sm:grid", open ? "grid" : "hidden")}>
        {children}
      </ol>
    </section>
  );
}
