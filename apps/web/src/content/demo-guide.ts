import type { CircleRole } from "@kin/domain";

import type { DemoPayee } from "@/content/circle/payout-proof";
import { askRoute, dashboardRoutes, listenRoute, verifyRoute } from "@/content/dashboard-routes";
import { localizedPath, pagePath } from "@/i18n/routing";
import type { Locale } from "@/i18n/locales";

/** The overview's query that opens the "Add money" sheet at once. */
export const TOP_UP_OPEN = { name: "topUp", value: "open" } as const;

/** The screens a guide step may lead to after a seat change, and nothing else. */
const GUIDE_PAGES: ReadonlySet<string> = new Set([dashboardRoutes.overview, askRoute, dashboardRoutes.approvals, listenRoute, verifyRoute]);

/** What stands behind a step: PayPal's sandbox, Claude, the speech service, the record's own arithmetic, or simulated money. */
export type GuideBadge = "sandbox" | "claude" | "spoken" | "provable" | "simulated";

export type GuideStepKey = "topUp" | "ask" | "approve" | "listen" | "verify";

export type GuideStep = {
  readonly key: GuideStepKey;
  readonly badge: GuideBadge;
  /** Where the step leads, language prefix included. */
  readonly href: string;
  /** The seat to take first, when the visitor is not in it already; `null` when the link goes straight there. */
  readonly seat: string | null;
};

type Persona = { readonly memberId: string; readonly role: CircleRole };

export type GuideInput = {
  readonly locale: Locale;
  readonly personas: readonly Persona[];
  readonly current: string;
  /** "Reorder Rose's refill", in the visitor's language. */
  readonly refillQuestion: string;
  /** Whether this deployment takes top-ups through PayPal at all. */
  readonly topUps: boolean;
  /** How this demo circle's caregiver payouts are paid. */
  readonly payee: DemoPayee;
};

/**
 * The judge's path through a demo circle: five steps, each a link with what is
 * real behind it. The badges follow the deployment: a caregiver payout says
 * "PayPal sandbox" only where the worker pays demo payouts there, and the top-up
 * step is left out where there is no PayPal app. Steps the parent takes go
 * through her seat; the others through the organizer's.
 */
export function demoGuide(input: GuideInput): GuideStep[] {
  const seatOf = (role: CircleRole) => input.personas.find((persona) => persona.role === role)?.memberId ?? null;
  const step = (key: GuideStepKey, badge: GuideBadge, role: CircleRole, path: string): GuideStep => {
    const seat = seatOf(role);
    return { key, badge, href: localizedPath(input.locale, path), seat: seat === null || seat === input.current ? null : seat };
  };
  const topUp = `${dashboardRoutes.overview}?${new URLSearchParams({ [TOP_UP_OPEN.name]: TOP_UP_OPEN.value }).toString()}`;
  const ask = `${askRoute}?${new URLSearchParams({ q: input.refillQuestion }).toString()}`;
  return [
    ...(input.topUps ? [step("topUp", "sandbox", "organizer", topUp)] : []),
    step("ask", "claude", "organizer", ask),
    step("approve", input.payee === "sandbox" ? "sandbox" : "simulated", "parent", dashboardRoutes.approvals),
    step("listen", "spoken", "parent", listenRoute),
    step("verify", "provable", "organizer", verifyRoute),
  ];
}

/**
 * Where a guide step's seat change may send the visitor: one of the guide's
 * own screens, in any language, with its query. Anything else, another site
 * included, is `null`, so the form cannot be used to send someone elsewhere.
 */
export function guideDestination(value: string | null): string | null {
  if (value === null || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const base = "http://kin.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base || !GUIDE_PAGES.has(pagePath(url.pathname))) return null;
  return `${url.pathname}${url.search}`;
}
