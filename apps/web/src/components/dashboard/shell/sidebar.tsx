import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/shared/avatar";
import { circlePortraits } from "@/content/circle-portraits";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";

import { PauseSheet } from "./pause-sheet";
import type { ShellContext } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";

/**
 * The navy column down the side of a wide screen: the circle, its sections
 * and the pause switch. It is always a dark surface, whatever the theme, so it
 * takes the dark theme's colours for everything inside it.
 */
export function Sidebar({ locale, dictionary, month, clock, badges, pause }: ShellContext) {
  const { shell, demoAction } = dictionary.dashboard;
  const themeAttribute = { "data-theme": "dark" };

  return (
    <aside
      {...themeAttribute}
      className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-band px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-5 text-foreground lg:flex"
    >
      <div className="px-2">
        <Logo href={localizedPath(locale, dashboardRoutes.overview)} label={shell.homeLabel} />
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-band-border bg-foreground/5 p-3">
        <Avatar src={circlePortraits.rose} size="md" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{shell.circleName}</p>
          <p className="truncate text-sm text-muted-foreground">{month}</p>
        </div>
      </div>
      <SidebarNav locale={locale} copy={shell} badges={badges} />
      <div className="mt-auto space-y-4">
        <PauseSheet copy={pause} note={demoAction} trigger="full" className="w-full border-band-border bg-transparent hover:bg-foreground/5" />
        <p className="px-2 text-xs text-muted-foreground">{clock}</p>
      </div>
    </aside>
  );
}
