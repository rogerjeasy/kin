import { mainNav, routes } from "@/content/site-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { cn } from "@/lib/utils";

import { NavLink } from "./nav-link";

type MainNavProps = {
  locale: Locale;
  labels: Dictionary["common"]["nav"];
  className?: string;
};

export function MainNav({ locale, labels, className }: MainNavProps) {
  return (
    <nav aria-label={labels.label} className={cn("items-center gap-7", className)}>
      {mainNav.map((key) => (
        <NavLink key={key} href={localizedPath(locale, routes[key])} route={routes[key]}>
          {labels[key]}
        </NavLink>
      ))}
    </nav>
  );
}
