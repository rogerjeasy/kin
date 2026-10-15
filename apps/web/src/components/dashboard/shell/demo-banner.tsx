import { FlaskConicalIcon, LogOutIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { leaveDemo, startDemoAgain } from "@/server/demo-actions";

import { RoleSwitcher } from "./role-switcher";
import type { ShellContext } from "./shell-context";

type DemoBannerProps = {
  locale: Locale;
  copy: Dictionary["dashboard"]["shell"]["demo"];
  demo: NonNullable<ShellContext["demo"]>;
};

/**
 * Says on every screen that the circle is a demonstration. Simulated money is
 * always labelled as simulated (AGENTS.md section 5, rule 9), so this cannot
 * be dismissed. From here a visitor takes another role, starts again, or
 * leaves.
 */
export function DemoBanner({ locale, copy, demo }: DemoBannerProps) {
  return (
    <div role="note" className="space-y-3 rounded-xl border border-highlight/25 bg-highlight/8 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <FlaskConicalIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
        <p className="min-w-0">
          <strong className="font-semibold">{copy.label}.</strong> <span className="text-muted-foreground">{demo.text}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 ps-7">
        <RoleSwitcher locale={locale} label={copy.viewAs} seat={demo.seat} personas={demo.personas} />
        <form action={startDemoAgain}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="ghost" size="sm" className="min-h-11" title={copy.restartNote}>
            <RotateCcwIcon aria-hidden="true" />
            {copy.restart}
          </Button>
        </form>
        <form action={leaveDemo}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="ghost" size="sm" className="min-h-11">
            <LogOutIcon aria-hidden="true" />
            {copy.leave}
          </Button>
        </form>
      </div>
    </div>
  );
}
