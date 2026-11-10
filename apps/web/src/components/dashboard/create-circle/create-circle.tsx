import { PARENT_LEVELS } from "@kin/domain";
import type { ReactNode } from "react";

import { KnotMark } from "@/components/brand/knot-mark";
import { CONTENT_ID } from "@/components/layout/skip-link";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { createCircleAction } from "@/server/circle-actions";

import { Field, inputClass } from "./field";
import { TimezoneSelect } from "./timezone-select";

type CreateCircleProps = {
  locale: Locale;
  copy: Dictionary["dashboard"]["createCircle"];
  levels: Dictionary["dashboard"]["circle"]["parent"]["levels"];
  signOut: string;
  /** Who is signed in, so they know whose circle this will be. */
  signedIn: { label: string; name: string; email: string };
  /** What the last attempt said, if anything. */
  notice: ReactNode;
};

/**
 * What a person who signed in sees before they belong to any circle: a short
 * form to start their own. They become its organizer; the parent is its
 * first member. Invited people never see this: their circle opens instead.
 */
export function CreateCircle({ locale, copy, levels, signOut, signedIn, notice }: CreateCircleProps) {
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <main id={CONTENT_ID} className="flex min-h-dvh justify-center px-4 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <section aria-labelledby="create-circle-heading" className="w-full max-w-xl self-start surface rounded-3xl p-5 sm:p-8">
        <KnotMark className="size-10" />
        <p className="mt-6 text-sm font-semibold text-highlight">{copy.eyebrow}</p>
        <h1 id="create-circle-heading" className="mt-1 font-serif text-subtitle text-balance">
          {copy.title}
        </h1>
        <p className="mt-3 text-pretty text-muted-foreground">{copy.text}</p>
        <div className="mt-5 empty:hidden">{notice}</div>
        <form action={createCircleAction} className="mt-6 grid gap-5">
          <input type="hidden" name="locale" value={locale} />
          <Field id="parentName" label={copy.parentName.label}>
            <input id="parentName" name="parentName" required maxLength={80} autoComplete="off" className={inputClass} />
          </Field>
          <Field id="name" label={copy.name.label} hint={copy.name.hint}>
            <input id="name" name="name" required maxLength={80} autoComplete="off" aria-describedby="name-hint" className={inputClass} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-medium">{copy.parentLevel.label}</legend>
            {PARENT_LEVELS.map((level, index) => (
              <label key={level} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-3 has-checked:border-primary has-checked:bg-primary/5">
                <input type="radio" name="parentLevel" value={level} defaultChecked={index === 0} required className="mt-1 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium">{levels[level].title}</span>
                  <span className="block text-sm text-pretty text-muted-foreground">{levels[level].text}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field id="relationship" label={copy.relationship.label} hint={copy.relationship.hint}>
            <input id="relationship" name="relationship" maxLength={60} autoComplete="off" aria-describedby="relationship-hint" className={inputClass} />
          </Field>
          <Field id="timezone" label={copy.timezone.label} hint={copy.timezone.hint}>
            <TimezoneSelect id="timezone" name="timezone" describedBy="timezone-hint" zones={zones} />
          </Field>
          <div className="grid gap-1.5">
            <p className="font-medium">{copy.currency.label}</p>
            <p className="text-sm text-pretty text-muted-foreground">{copy.currency.value}</p>
          </div>
          <Button type="submit" className="min-h-11 justify-self-start">
            {copy.submit}
          </Button>
        </form>
        <p className="mt-6 border-t pt-5 text-sm text-pretty text-muted-foreground">{copy.invited}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 text-sm">
            <span className="text-muted-foreground">{signedIn.label}</span> <strong className="font-semibold">{signedIn.name}</strong>{" "}
            <span className="break-all text-muted-foreground">({signedIn.email})</span>
          </p>
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="ghost" size="sm" className="min-h-11">
              {signOut}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
