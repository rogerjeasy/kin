import { authorize, type CircleAction } from "@kin/auth";
import type { CircleSnapshot } from "@kin/db";
import type { CircleRole } from "@kin/domain";
import { notFound, redirect } from "next/navigation";

import { dashboardNav, dashboardRoutes, type DashboardSection } from "@/content/dashboard-routes";
import { pageContext, type PageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";

import { circleOf } from "./circle";
import { requireViewer, type Viewer } from "./viewer";

/** What a role must be allowed to do to open each of the circle's screens. */
export const SECTION_ACCESS = {
  overview: "money.view",
  shifts: "shift.view",
  approvals: "own_payments.view",
  bills: "own_payments.view",
  fairness: "money.view",
  record: "money.view",
  // Whoever may see the circle's money may hear it.
  listen: "money.view",
  circle: "circle.view",
} as const satisfies Record<DashboardSection, CircleAction>;

/** The viewer's seat in the circle, as the access check reads it. */
export function seatOf(circle: CircleSnapshot) {
  return { role: circle.viewer.role, status: "active" as const };
}

/** Whether the viewer's role may take `action` in this circle. */
export function may(circle: CircleSnapshot, action: CircleAction): boolean {
  return authorize(seatOf(circle), action).allowed;
}

/**
 * The sections a role may open, in the order of the navigation. The parent's
 * seat puts Listen first: Kin is built around her hearing her money, so that
 * is her first screen, and the family's dashboard is one tap away.
 */
export function sectionsForRole(role: CircleRole): DashboardSection[] {
  const allowed = dashboardNav.filter((section) => authorize({ role, status: "active" }, SECTION_ACCESS[section]).allowed);
  return role === "parent" && allowed.includes("listen") ? ["listen", ...allowed.filter((section) => section !== "listen")] : allowed;
}

/** The sections the viewer may open in this circle. */
export function sectionsFor(circle: CircleSnapshot): DashboardSection[] {
  return sectionsForRole(circle.viewer.role);
}

export type ShellData = PageContext & { viewer: Viewer; circle: CircleSnapshot | null };

/**
 * What the frame of the circle's screens needs first: its language and copy,
 * the viewer, and the circle they see. Without a viewer it never returns, so
 * nothing below it reads a circle for someone who is neither signed in nor
 * in the demo.
 */
export async function shellData(params: Promise<{ locale: string }>, section: DashboardSection): Promise<ShellData> {
  const context = await pageContext(params);
  const viewer = await requireViewer(localizedPath(context.locale, dashboardRoutes[section]));
  return { ...context, viewer, circle: await circleOf(viewer) };
}

export type DashboardContext = PageContext & { viewer: Viewer; circle: CircleSnapshot };

/**
 * What one of the circle's screens needs: the frame's data, with a circle the
 * viewer may open this screen of. Without a circle, the layout offers to
 * start one. A role refused a screen is sent to one it may open.
 */
export async function dashboardContext(params: Promise<{ locale: string }>, section: DashboardSection): Promise<DashboardContext> {
  const { circle, ...rest } = await shellData(params, section);
  if (circle === null) notFound();
  const sections = sectionsFor(circle);
  if (!sections.includes(section)) {
    // A caregiver goes to the screens of their own payments.
    const [first] = sections;
    if (first === undefined) notFound();
    redirect(localizedPath(rest.locale, dashboardRoutes[first]));
  }
  return { ...rest, circle };
}
