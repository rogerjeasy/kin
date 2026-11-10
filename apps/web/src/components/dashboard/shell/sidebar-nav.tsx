"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { dashboardRoutes, sectionOf, type DashboardSection } from "@/content/dashboard-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import type { NavBadge } from "./nav-badge";
import { sectionIcons } from "./section-icons";

type SidebarNavProps = {
  locale: Locale;
  copy: Dictionary["dashboard"]["shell"];
  badges: Partial<Record<DashboardSection, NavBadge>>;
  /** The sections the viewer may open, in their order for this role. The others are not offered. */
  sections: readonly DashboardSection[];
};

/** The circle's sections, down the side of a wide screen. */
export function SidebarNav({ locale, copy, badges, sections }: SidebarNavProps) {
  const current = sectionOf(useSelectedLayoutSegment());

  return (
    <nav aria-label={copy.navLabel}>
      <ul className="space-y-1">
        {sections.map((section) => {
          const Icon = sectionIcons[section];
          const badge = badges[section];
          return (
            <li key={section}>
              <Link
                href={localizedPath(locale, dashboardRoutes[section])}
                aria-current={current === section ? "page" : undefined}
                className="group relative isolate flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground aria-[current=page]:text-foreground"
              >
                {current === section ? (
                  <motion.span
                    layoutId="sidebar-current"
                    aria-hidden="true"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    className="absolute inset-0 -z-10 rounded-xl bg-foreground/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                  >
                    <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-highlight shadow-[0_0_12px_2px_rgb(var(--glow-gold)/0.7)]" />
                  </motion.span>
                ) : null}
                <Icon aria-hidden="true" className="size-5 shrink-0 transition-transform duration-300 group-hover:scale-110 group-aria-[current=page]:text-highlight" />
                <span className="min-w-0 flex-1 truncate">{copy.nav[section]}</span>
                {badge ? (
                  <span className="rounded-full bg-highlight px-2 py-0.5 text-xs font-semibold text-band tabular-nums">
                    <span aria-hidden="true">{badge.value}</span>
                    <span className="sr-only">{badge.label}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
