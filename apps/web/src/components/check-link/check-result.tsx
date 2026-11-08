import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";
import { numberLocaleOf, type Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { CheckLinkProblem, PublicCheck } from "@/server/check-link";

type Copy = Dictionary["checkLink"];

/** A time on the circle's clock, which is where the visit happens, whatever zone the phone is set to. */
function clock(locale: Locale, timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat(numberLocaleOf(locale), { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** "Planned visit: 9:00 AM to 3:00 PM.", on the circle's clock. */
export function plannedWords(copy: Copy, locale: Locale, planned: { readonly startsAt: string; readonly endsAt: string; readonly timezone: string }): string {
  return fill(copy.planned, { start: clock(locale, planned.timezone, planned.startsAt), end: clock(locale, planned.timezone, planned.endsAt) });
}

/** The words for a tap that went through, from what the record says. */
export function checkWords(copy: Copy, locale: Locale, check: PublicCheck): { readonly text: string; readonly planned: string } {
  const at = check.action === "in" ? check.checkedInAt : check.checkedOutAt;
  const time = at === null ? "" : clock(locale, check.timezone, at);
  const slots = { time, name: check.name };
  const text = check.action === "in" ? fill(check.turned ? copy.results.checkedIn : copy.results.alreadyIn, slots) : fill(check.turned ? copy.results.checkedOut : copy.results.alreadyOut, slots);
  return { text, planned: plannedWords(copy, locale, check) };
}

type Props = { copy: Copy; locale: Locale; outcome: { readonly check: PublicCheck } | { readonly problem: CheckLinkProblem } };

/** What came of the tap, large and in words: a tick for done, a triangle for a problem, never colour alone. */
export function CheckResult({ copy, locale, outcome }: Props) {
  if ("problem" in outcome) {
    return (
      <p role="alert" className="flex min-w-0 items-start gap-3 text-xl font-medium text-pretty text-danger">
        <TriangleAlertIcon aria-hidden="true" className="mt-1 size-7 shrink-0" />
        <span className="min-w-0">{copy.problems[outcome.problem]}</span>
      </p>
    );
  }
  const words = checkWords(copy, locale, outcome.check);
  return (
    <div role="status" className="min-w-0 space-y-2">
      <p className="flex min-w-0 items-start gap-3 text-xl font-semibold text-pretty text-positive">
        <CheckCircle2Icon aria-hidden="true" className="mt-1 size-7 shrink-0" />
        <span className="min-w-0">{words.text}</span>
      </p>
      <p className="text-base text-muted-foreground text-pretty">{words.planned}</p>
    </div>
  );
}
