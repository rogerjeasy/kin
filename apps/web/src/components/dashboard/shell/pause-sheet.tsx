"use client";

import { PauseIcon } from "lucide-react";

import { DemoActions } from "@/components/dashboard/ui/demo-actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Dictionary } from "@/i18n/dictionary";

type PauseSheetProps = {
  copy: Dictionary["dashboard"]["pause"];
  note: Dictionary["dashboard"]["demoAction"];
  /** The sidebar shows the words. The top bar of a phone shows only the icon. */
  trigger: "full" | "icon";
  className?: string;
};

/**
 * The pause switch (docs/architecture.md section 15.3). Any member can hold
 * every outgoing payment for a day, so pressing it first says plainly what it
 * does and asks again.
 */
export function PauseSheet({ copy, note, trigger, className }: PauseSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger === "full" ? (
          <Button type="button" variant="outline" size="sm" className={className}>
            <PauseIcon />
            {copy.button}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" aria-label={copy.button} className={className}>
            <PauseIcon />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-md">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <PauseIcon className="size-6" />
        </span>
        <SheetTitle className="mt-5 pe-8 font-serif text-subtitle font-normal text-balance">{copy.title}</SheetTitle>
        <SheetDescription className="mt-3 text-base">{copy.text}</SheetDescription>
        <ul className="mt-6 space-y-3 border-t pt-6">
          {copy.points.map((point) => (
            <li key={point} className="grid grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-3">
              <span aria-hidden="true" className="size-1.5 translate-y-[-0.125rem] rounded-full bg-highlight" />
              {point}
            </li>
          ))}
        </ul>
        <DemoActions className="mt-8" actions={[{ label: copy.confirm }]} note={note} />
        <SheetClose asChild>
          <Button type="button" variant="ghost" className="mt-2 self-start">
            {copy.cancel}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
