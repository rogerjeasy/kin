/** The signed-in screens of a circle, as paths before any language prefix. */
export const dashboardRoutes = {
  overview: "/dashboard",
  shifts: "/dashboard/shifts",
  approvals: "/dashboard/approvals",
  bills: "/dashboard/bills",
  fairness: "/dashboard/fairness",
  record: "/dashboard/record",
  /** What Kin says aloud about confirmed money, in very large type: the parent's own front door. */
  listen: "/dashboard/listen",
  circle: "/dashboard/circle",
} as const;

export type DashboardSection = keyof typeof dashboardRoutes;

/** The family agreement: a screen within the circle's section, not a section of its own. */
export const agreementRoute = "/dashboard/circle/agreement";

/** The parent's standing permissions: a screen within the circle's section, like the agreement. */
export const mandatesRoute = "/dashboard/circle/mandates";

/** The parent's standing permission to pay confirmed care shifts, and the caregivers' pay rules: a screen within the circle's section, like the agreement. */
export const shiftPermissionsRoute = "/dashboard/circle/shifts";

/** Written care agreements with signatures: a screen within the circle's section, like the family agreement. */
export const careAgreementsRoute = "/dashboard/circle/care-agreements";

/** The parent's wishes, and what happens when a trigger is attested: a screen within the circle's section, open to every role (a caregiver sees the trigger only). */
export const wishesRoute = "/dashboard/circle/wishes";

/** The packet for an elder-law attorney: a screen of the record, not a section of its own. Its `/export` is the download. */
export const packetRoute = "/dashboard/record/packet";

/** The family money studio: the record as an AG Studio dashboard. A screen of the record, not a section of its own. */
export const studioRoute = "/dashboard/record/studio";

/** The door tag: a printable card whose code opens a caregiver's own shifts. A screen of the shifts, not a section of its own. */
export const shiftDoorRoute = "/dashboard/shifts/door";

/** What Kin says aloud about confirmed money: a section of its own, and the parent's first screen. */
export const listenRoute = dashboardRoutes.listen;

/** Ask Kin, the agent that reads the record with tools: a screen of the overview, not a section of its own. */
export const askRoute = "/dashboard/ask";

/** "Is it really you?": a caller says they are family and asks for money, and Kin asks the real person. A screen of the overview, not a section of its own. */
export const presenceRoute = "/dashboard/presence";

/** Quiet shares: a cost the family covers together, each person's limit kept private. A screen of fairness, not a section of its own. */
export const quietSharesRoute = "/dashboard/fairness/quiet-shares";

/** The demo's family layout of quiet shares: each sharer's own screen side by side. Demo circles only. */
export const quietSharesFamilyRoute = "/dashboard/fairness/quiet-shares/family";

/** The parent's Purse: her own allowance, spent by her word. A screen of the overview, not a section of its own. */
export const purseRoute = "/dashboard/purse";

/** The family office line, where a demanding caller is handed to Kin: a screen of the bills, not a section of its own. */
export const officeLineRoute = "/dashboard/office-line";
/** Where the circle's record is checked again; its `/export` is the file anyone can check offline with `kin-verify`. */
export const verifyRoute = "/dashboard/record/verify";

/** Connected assistants: a member's own AI assistant and an agency's software, which read and propose and never approve. A screen within the circle's section. */
export const connectionsRoute = "/dashboard/circle/connections";

/** Sign-in security: the person's own authenticator app, which a yes to real money asks for. A screen within the circle's section, open to every role. */
export const securityRoute = "/dashboard/circle/security";

/** The sidebar, in order. The parent's seat moves Listen to the front (`sectionsForRole`). */
export const dashboardNav = ["overview", "shifts", "approvals", "bills", "fairness", "record", "listen", "circle"] as const satisfies readonly DashboardSection[];

/** Sections a phone reaches through the account menu instead of the bottom bar. */
const MENU_SECTIONS: readonly DashboardSection[] = ["record", "circle"];

/** A phone's bottom bar has room for five: the viewer's first five sections that are not in the account menu. */
export function phoneSections(sections: readonly DashboardSection[]): DashboardSection[] {
  return sections.filter((section) => !MENU_SECTIONS.includes(section)).slice(0, 5);
}

/** The section a route segment under /dashboard belongs to. */
export function sectionOf(segment: string | null): DashboardSection {
  if (segment === null) return "overview";
  return dashboardNav.find((section) => dashboardRoutes[section] === `/dashboard/${segment}`) ?? "overview";
}
