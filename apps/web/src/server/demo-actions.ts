"use server";

import { issueDemoSession, DEMO_SESSION_DAYS } from "@kin/auth";
import { asPerson, createDemoVisitor, leaveDemoCircle, membershipsOf, takeDemoSeat } from "@kin/db";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dashboardRoutes } from "@/content/dashboard-routes";
import { withNotice } from "@/content/dashboard-notices";
import { routes } from "@/content/site-routes";
import { localizedPath } from "@/i18n/routing";

import { clearedDemoCookie, demoCookie } from "./auth/demo-cookie";
import { joinDemo } from "./circle";
import { sectionsForRole } from "./dashboard-context";
import { databases } from "./database";
import { demoConfig } from "./demo-config";
import { formLocale, formText } from "./form";
import { currentVisitor } from "./viewer";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Demo button. Creates an anonymous visitor, so each press is a row Kin
 * can count without an account, gives them their own copy of Rose's circle,
 * and opens it. A visitor who already has a demo goes back to it.
 */
export async function startDemo(form: FormData): Promise<void> {
  const locale = formLocale(form);
  const demo = demoConfig();
  if (!demo.enabled) redirect(localizedPath(locale, routes.home));
  let visitor = await currentVisitor();
  if (visitor === null) {
    visitor = await createDemoVisitor(databases().app);
    const token = issueDemoSession(demo.sessionKey, { visitorId: visitor, expiresAt: new Date(Date.now() + DEMO_SESSION_DAYS * DAY_MS) });
    const cookie = demoCookie(token);
    (await cookies()).set(cookie.name, cookie.value, cookie.options);
  }
  await joinDemoIfNeeded(visitor);
  revalidatePath("/[locale]/dashboard", "layout");
  redirect(localizedPath(locale, dashboardRoutes.overview));
}

async function joinDemoIfNeeded(visitor: string): Promise<void> {
  const seats = await asPerson(databases().app, visitor, (tx) => membershipsOf(tx, visitor));
  if (seats.length === 0) await joinDemo(visitor);
}

/** Leaves the demo. A person who is also signed in is back in their own account. */
export async function leaveDemo(form: FormData): Promise<void> {
  const locale = formLocale(form);
  const cookie = clearedDemoCookie();
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  redirect(localizedPath(locale, routes.home));
}

/** A fresh copy of Rose's circle. The old one is archived, never deleted. */
export async function startDemoAgain(form: FormData): Promise<void> {
  const locale = formLocale(form);
  const visitor = await requireVisitor(locale);
  const { app } = databases();
  const seats = await asPerson(app, visitor, (tx) => membershipsOf(tx, visitor));
  for (const seat of seats.filter((each) => each.demoSeat)) {
    await asPerson(app, visitor, (tx) => leaveDemoCircle(tx, seat.circleId));
  }
  await joinDemo(visitor);
  revalidatePath("/[locale]/dashboard", "layout");
  redirect(withNotice(localizedPath(locale, dashboardRoutes.overview), "restarted"));
}

/** Sees the demo circle from another persona's seat, and so from their role. */
export async function switchDemoRole(form: FormData): Promise<void> {
  const locale = formLocale(form);
  const visitor = await requireVisitor(locale);
  const memberId = formText(form, "member");
  const { app } = databases();
  const [seat] = await asPerson(app, visitor, (tx) => membershipsOf(tx, visitor));
  if (memberId && seat) {
    await asPerson(app, visitor, (tx) => takeDemoSeat(tx, seat.circleId, memberId));
  }
  // The new role's first screen: a caregiver lands on their own payments.
  const [now] = await asPerson(app, visitor, (tx) => membershipsOf(tx, visitor));
  const [landing = "overview"] = now ? sectionsForRole(now.role) : [];
  revalidatePath("/[locale]/dashboard", "layout");
  redirect(withNotice(localizedPath(locale, dashboardRoutes[landing]), "roleChanged"));
}

async function requireVisitor(locale: Parameters<typeof localizedPath>[0]): Promise<string> {
  const visitor = await currentVisitor();
  if (visitor === null) redirect(localizedPath(locale, routes.home));
  return visitor;
}
