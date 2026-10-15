import type { Session } from "@kin/auth";

import { dashboardRoutes, type DashboardSection } from "@/content/dashboard-routes";
import { pageContext, type PageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";

import { requireSession } from "./auth/session";

export type DashboardContext = PageContext & { session: Session };

/**
 * What every circle screen needs first: its language and copy, and a verified
 * session. Without a session it never returns, so nothing below it can read
 * the circle's data for someone who is not signed in.
 */
export async function dashboardContext(params: Promise<{ locale: string }>, section: DashboardSection): Promise<DashboardContext> {
  const context = await pageContext(params);
  const session = await requireSession(localizedPath(context.locale, dashboardRoutes[section]));
  return { ...context, session };
}
