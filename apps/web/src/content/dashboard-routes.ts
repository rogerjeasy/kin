/** The signed-in screens of a circle, as paths before any language prefix. */
export const dashboardRoutes = {
  overview: "/dashboard",
  approvals: "/dashboard/approvals",
  bills: "/dashboard/bills",
  fairness: "/dashboard/fairness",
  record: "/dashboard/record",
  circle: "/dashboard/circle",
} as const;

export type DashboardSection = keyof typeof dashboardRoutes;

/** The family agreement: a screen within the circle's section, not a section of its own. */
export const agreementRoute = "/dashboard/circle/agreement";

/** The parent's standing permissions: a screen within the circle's section, like the agreement. */
export const mandatesRoute = "/dashboard/circle/mandates";

/** What Kin says aloud about confirmed money: a screen of the overview, not a section of its own. */
export const listenRoute = "/dashboard/listen";

/** The family office line, where a demanding caller is handed to Kin: a screen of the bills, not a section of its own. */
export const officeLineRoute = "/dashboard/office-line";
/** Where the circle's record is checked again; its `/export` is the file anyone can check offline with `kin-verify`. */
export const verifyRoute = "/dashboard/record/verify";

/** The sidebar, in order. */
export const dashboardNav = ["overview", "approvals", "bills", "fairness", "record", "circle"] as const satisfies readonly DashboardSection[];

/** A phone's bottom bar has room for five. The circle is in the account menu. */
export const phoneNav = ["overview", "approvals", "bills", "fairness", "record"] as const satisfies readonly DashboardSection[];

/** The section a route segment under /dashboard belongs to. */
export function sectionOf(segment: string | null): DashboardSection {
  if (segment === null) return "overview";
  return dashboardNav.find((section) => dashboardRoutes[section] === `/dashboard/${segment}`) ?? "overview";
}
