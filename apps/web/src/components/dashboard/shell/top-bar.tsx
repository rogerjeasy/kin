import Link from "next/link";

import { KnotMark } from "@/components/brand/knot-mark";
import { LanguageMenu } from "@/components/layout/language-menu";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { routes } from "@/content/site-routes";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { ThemeToggle } from "@/theme/theme-toggle";

import { AccountMenu } from "./account-menu";
import { PauseSheet } from "./pause-sheet";
import type { ShellContext } from "./shell-context";

/**
 * Across the top of the circle's screens. On a phone it carries the circle's
 * name and the pause switch, which the sidebar holds on a wide screen.
 */
export function TopBar({ locale, dictionary, clock, pause, pauseState, viewer, circle }: ShellContext) {
  const { common } = dictionary;
  const { shell } = dictionary.dashboard;
  const path = (route: string) => localizedPath(locale, route);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      <div className="flex min-h-16 items-center gap-2 px-4 sm:px-6 lg:px-10">
        <Link href={path(dashboardRoutes.overview)} aria-label={fill(shell.homeLabel, { circle: circle.name })} className="inline-flex min-h-11 min-w-0 items-center gap-2.5 lg:hidden">
          <KnotMark className="size-7" />
          <span className="truncate font-semibold">{circle.name}</span>
        </Link>
        <p className="hidden truncate text-sm text-muted-foreground lg:block">{clock}</p>
        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          {/* On a phone only the globe shows, so the circle's name keeps its room. */}
          <LanguageMenu
            locale={locale}
            label={common.language.label}
            display="code"
            className="max-sm:w-11 max-sm:px-0 max-sm:[&>span]:hidden max-sm:[&>svg:last-child]:hidden"
          />
          <ThemeToggle labels={common.theme} />
          <PauseSheet locale={locale} copy={pause} state={pauseState} trigger="icon" className="lg:hidden" />
          <AccountMenu
            locale={locale}
            copy={shell.account}
            leaveLabel={shell.demo.leave}
            viewer={viewer}
            links={{ circle: path(dashboardRoutes.circle), website: path(routes.home) }}
          />
        </div>
      </div>
    </header>
  );
}
