import type { Notice } from "@/content/dashboard-notices";
import type { DashboardSection } from "@/content/dashboard-routes";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import type { NavBadge } from "./nav-badge";

/** One persona of the demo circle, whose seat a visitor can take. */
export type DemoPersona = { memberId: string; name: string; role: string; portrait: string | null; current: boolean };

/** One step of the demo guide, worded: where it leads, what is real behind it, and the seat to take first, if any. */
export type DemoGuideStepView = { key: string; number: string; title: string; badge: string; real: boolean; href: string; seat: string | null };

/** The demo guide as the banner shows it, or put away by this visitor. */
export type DemoGuideView = { hidden: boolean; title: string; steps: readonly DemoGuideStepView[] };

/** What every part of the circle's frame needs. */
export type ShellContext = {
  locale: Locale;
  dictionary: Dictionary;
  /** "October 2026". */
  month: string;
  /** "Demo clock · Friday 30 October 2026", or the date in a real circle. */
  clock: string;
  badges: Partial<Record<DashboardSection, NavBadge>>;
  /** Who is looking: a person who signed in, or an anonymous demo visitor. */
  viewer: { kind: "person" | "visitor"; name: string; email: string | null };
  /** The circle on show: its name, its parent's portrait, and whether it is a demo. */
  circle: { name: string; portrait: string | null; parentName: string; demo: boolean };
  /** In the demo, whose seat the visitor holds and the others they can take, and the five-step guide. */
  demo: { seat: string; text: string; personas: readonly DemoPersona[]; guide: DemoGuideView } | null;
  /** The sections the viewer's role may open. */
  sections: readonly DashboardSection[];
  /** The pause sheet's words, with the length of a pause and the parent filled in. */
  pause: Dictionary["dashboard"]["pause"];
  /** Whether the circle is paused, and what the viewer may do about it. */
  pauseState: { active: string | null; canPause: boolean; canResume: boolean };
  /** Outgoing money held by an "is it really you?" check, said on every screen while it lasts, with where to read the check. */
  presenceHold: { text: string; link: { href: string; label: string } | null } | null;
  /** What an action did, in this circle's words: a demo never says PayPal will confirm. */
  notices: Readonly<Record<Notice, string>>;
  /** Someone said the parent is in hospital or a care home: said on every screen while it is reported or active, with the way to what changed. */
  wishesNotice?: { text: string; link: { href: string; label: string } } | null;
};
