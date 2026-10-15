"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { dashboardRoutes, phoneNav, sectionOf, type DashboardSection } from "@/content/dashboard-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { cn } from "@/lib/utils";

import type { NavBadge } from "./nav-badge";
import { sectionIcons } from "./section-icons";

type BottomNavProps = {
  locale: Locale;
  copy: Dictionary["dashboard"]["shell"];
  badges: Partial<Record<DashboardSection, NavBadge>>;
  /** The sections the viewer may open. The others are not offered. */
  sections: readonly DashboardSection[];
  className?: string;
};

// One column per section offered, so the tabs always fill the bar.
const columns = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5"] as const;

/** The circle's main sections, along the bottom of a phone or tablet, within thumb's reach. */
export function BottomNav({ locale, copy, badges, sections, className }: BottomNavProps) {
  const current = sectionOf(useSelectedLayoutSegment());
  const offered = phoneNav.filter((section) => sections.includes(section));

  return (
    <nav
      aria-label={copy.navLabel}
      className={cn("fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm", className)}
    >
      <ul className={cn("mx-auto grid max-w-2xl", columns[offered.length] ?? "grid-cols-5")}>
        {offered.map((section) => {
          const Icon = sectionIcons[section];
          const badge = badges[section];
          return (
            <li key={section} className="min-w-0">
              <Link
                href={localizedPath(locale, dashboardRoutes[section])}
                aria-current={current === section ? "page" : undefined}
                className="group flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-muted-foreground aria-[current=page]:text-foreground"
              >
                <span className="relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors group-aria-[current=page]:bg-secondary">
                  <Icon aria-hidden="true" className="size-5" />
                  {badge ? (
                    <span className="absolute -top-1 -end-0.5 min-w-4.5 rounded-full bg-highlight px-1 text-center text-[0.6875rem] leading-4.5 font-semibold text-background tabular-nums">
                      <span aria-hidden="true">{badge.value}</span>
                      <span className="sr-only">{badge.label}</span>
                    </span>
                  ) : null}
                </span>
                <span className="w-full truncate text-center text-xs font-medium">{copy.nav[section]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
