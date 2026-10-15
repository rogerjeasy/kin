"use client";

import { PauseIcon, PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { pauseAction, resumeAction } from "@/server/circle-actions";

import type { ShellContext } from "./shell-context";

type PauseSheetProps = {
  locale: Locale;
  copy: Dictionary["dashboard"]["pause"];
  state: ShellContext["pauseState"];
  /** The sidebar shows the words. The top bar of a phone shows only the icon. */
  trigger: "full" | "icon";
  className?: string;
};

/**
 * The pause switch (docs/architecture.md section 15.3). Any member but an
 * observer can hold every outgoing payment for a day, so pressing it first
 * says plainly what it does and asks again. While a pause holds, the sheet
 * says who paused and until when, and lets the organizer or that member lift it.
 */
export function PauseSheet({ locale, copy, state, trigger, className }: PauseSheetProps) {
  if (!state.canPause && state.active === null) return null;
  const label = state.active === null ? copy.button : copy.resume;
  const Icon = state.active === null ? PauseIcon : PlayIcon;
  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger === "full" ? (
          <Button type="button" variant="outline" size="sm" className={className}>
            <Icon />
            {label}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" aria-label={label} className={className}>
            <Icon />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-md">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <Icon className="size-6" />
        </span>
        {state.active === null ? (
          <>
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
            <form action={pauseAction} className="mt-8">
              <input type="hidden" name="locale" value={locale} />
              {/* Closing on submit: the screen comes back with a notice of what happened. */}
              <SheetClose asChild>
                <Button type="submit" className="min-h-11 whitespace-normal">
                  {copy.confirm}
                </Button>
              </SheetClose>
            </form>
          </>
        ) : (
          <>
            <SheetTitle className="mt-5 pe-8 font-serif text-subtitle font-normal text-balance">{state.active}</SheetTitle>
            <SheetDescription className="mt-3 text-base">{copy.text}</SheetDescription>
            {state.canResume ? (
              <form action={resumeAction} className="mt-8">
                <input type="hidden" name="locale" value={locale} />
                <SheetClose asChild>
                  <Button type="submit" className="min-h-11">
                    <PlayIcon />
                    {copy.resume}
                  </Button>
                </SheetClose>
              </form>
            ) : null}
          </>
        )}
        <SheetClose asChild>
          <Button type="button" variant="ghost" className="mt-2 self-start">
            {copy.cancel}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
