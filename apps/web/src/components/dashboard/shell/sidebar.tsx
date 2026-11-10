import { Logo } from "@/components/brand/logo";
import { MemberAvatar } from "@/components/dashboard/ui/member-avatar";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";

import { PauseSheet } from "./pause-sheet";
import type { ShellContext } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";

/**
 * The navy column down the side of a wide screen: the circle, its sections
 * and the pause switch. It is always a dark surface, whatever the theme, so it
 * takes the dark theme's colours for everything inside it.
 */
export function Sidebar({ locale, dictionary, month, clock, badges, pause, pauseState, circle, sections }: ShellContext) {
  const { shell } = dictionary.dashboard;
  const themeAttribute = { "data-theme": "dark" };

  return (
    <aside
      {...themeAttribute}
      className="aurora sticky top-0 hidden h-dvh flex-col gap-6 overflow-x-hidden overflow-y-auto border-e border-band-border/60 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-5 text-foreground lg:flex print:hidden"
    >
      <div className="px-2">
        <Logo href={localizedPath(locale, dashboardRoutes.overview)} label={fill(shell.homeLabel, { circle: circle.name })} />
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-band-border bg-band p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
        <span className="relative shrink-0 rounded-full p-0.5 ring-1 ring-band-highlight/60 motion-safe:animate-glow-pulse">
          <MemberAvatar portrait={circle.portrait} name={circle.parentName} size="md" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{circle.name}</p>
          <p className="truncate text-sm text-muted-foreground">{month}</p>
        </div>
      </div>
      <SidebarNav locale={locale} copy={shell} badges={badges} sections={sections} />
      <div className="mt-auto space-y-4">
        <PauseSheet locale={locale} copy={pause} state={pauseState} trigger="full" className="w-full border-band-border bg-transparent hover:bg-foreground/5" />
        <p className="px-2 text-xs text-muted-foreground">{clock}</p>
      </div>
    </aside>
  );
}
