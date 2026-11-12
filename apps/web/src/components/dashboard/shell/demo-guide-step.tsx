import { ArrowRightIcon, BadgeCheckIcon, FlaskConicalIcon } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Locale } from "@/i18n/locales";
import { switchDemoRole } from "@/server/demo-actions";

import type { DemoGuideStepView } from "./shell-context";

type Props = { locale: Locale; step: DemoGuideStepView };

const ROW = "group flex h-full min-h-11 w-full min-w-0 items-start gap-2.5 rounded-xl border border-border/70 px-3 py-2.5 text-start transition-colors duration-300 hover:border-highlight/40 hover:bg-accent";

/**
 * One step of the demo guide. A step in another persona's seat is a form that
 * takes the seat and opens the step's screen in one press, through the same
 * action as the role switcher; one in the visitor's own seat is a plain link.
 */
export function DemoGuideStep({ locale, step }: Props) {
  const body = (
    <>
      <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-highlight/12 text-xs font-semibold text-highlight ring-1 ring-highlight/30">
        {step.number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className="font-medium text-pretty break-words text-foreground">{step.title}</span>
        <StatusPill tone={step.real ? "positive" : "neutral"} icon={step.real ? BadgeCheckIcon : FlaskConicalIcon}>
          {step.badge}
        </StatusPill>
      </span>
      <ArrowRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100" />
    </>
  );
  if (step.seat === null) {
    return (
      <Link href={step.href} className={ROW}>
        {body}
      </Link>
    );
  }
  return (
    <form action={switchDemoRole} className="h-full">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="member" value={step.seat} />
      <input type="hidden" name="next" value={step.href} />
      <button type="submit" className={ROW}>
        {body}
      </button>
    </form>
  );
}
