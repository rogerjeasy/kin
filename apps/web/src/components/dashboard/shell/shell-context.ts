import type { Session } from "@kin/auth";

import type { DashboardSection } from "@/content/dashboard-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import type { NavBadge } from "./nav-badge";

/** What every part of the circle's frame needs. */
export type ShellContext = {
  locale: Locale;
  dictionary: Dictionary;
  /** "October 2026". */
  month: string;
  /** "Demo clock · Friday 30 October 2026". */
  clock: string;
  badges: Partial<Record<DashboardSection, NavBadge>>;
  /** Who is signed in. */
  session: Session;
  /** The pause sheet's words, with the length of a pause filled in. */
  pause: Dictionary["dashboard"]["pause"];
};
