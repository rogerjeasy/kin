"use client";

import { UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { inviteAction } from "@/server/circle-actions";

type InviteSheetProps = {
  locale: Locale;
  trigger: string;
  copy: Dictionary["dashboard"]["circle"]["invite"];
  /** The roles someone can be invited to, with their names. */
  roles: readonly { value: string; label: string }[];
};

/** An organizer invites someone by email to a role. The server checks the organizer again. */
export function InviteSheet({ locale, trigger, copy, roles }: InviteSheetProps) {
  // Closed once the browser has accepted the fields, so the screen's notice is seen.
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11 w-full sm:w-auto">
          <UserPlusIcon aria-hidden="true" />
          {trigger}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-md">
        <SheetTitle className="pe-8 font-serif text-subtitle font-normal text-balance">{copy.title}</SheetTitle>
        <SheetDescription className="mt-3 text-base">{copy.text}</SheetDescription>
        <form action={inviteAction} onSubmit={() => setOpen(false)} className="mt-6 grid gap-5">
          <input type="hidden" name="locale" value={locale} />
          <Field id="invite-email" label={copy.email}>
            <input id="invite-email" name="email" type="email" required maxLength={254} autoComplete="email" className={inputClass} />
          </Field>
          <Field id="invite-role" label={copy.role}>
            <select id="invite-role" name="role" required defaultValue="contributor" className={inputClass}>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" className="min-h-11 justify-self-start">
            {copy.submit}
          </Button>
        </form>
        <SheetClose asChild>
          <Button type="button" variant="ghost" className="mt-2 self-start">
            {copy.cancel}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
