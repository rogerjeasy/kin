"use server";

import { CIRCLE_ROLES, PARENT_LEVELS, PAUSE_HOURS, type CircleRole, type ParentLevel } from "@kin/domain";
import { ProposalClosedError, answerProposal, asPerson, createCircle, inviteMember, pauseCircle, resumeCircle, type CircleSnapshot, type Seat } from "@kin/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dashboardRoutes, type DashboardSection } from "@/content/dashboard-routes";
import { withNotice, type Notice } from "@/content/dashboard-notices";
import type { Locale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { circleOf } from "./circle";
import { may, sectionsFor } from "./dashboard-context";
import { databases } from "./database";
import { formLocale, formText } from "./form";
import { requireViewer, type Viewer } from "./viewer";

const HOUR_MS = 60 * 60 * 1000;
/** How long an invitation waits to be accepted. */
const INVITATION_DAYS = 14;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** The only currency whose PayPal payout fee Kin has checked (packages/paypal). */
const CIRCLE_CURRENCY = "USD";

type Acting = { locale: Locale; viewer: Viewer; circle: CircleSnapshot; seat: Seat; back: (section: DashboardSection, notice: Notice) => never };

/**
 * Every action starts here: the viewer is checked, and the circle is read as
 * them, so the seat it acts from is the one row-level security gives them.
 * These are reachable by a direct POST, so none trusts the screen that sent it.
 */
async function acting(form: FormData, section: DashboardSection): Promise<Acting> {
  const locale = formLocale(form);
  const viewer = await requireViewer(localizedPath(locale, dashboardRoutes[section]));
  const circle = await circleOf(viewer);
  if (circle === null) redirect(localizedPath(locale, dashboardRoutes.overview));
  const sections = sectionsFor(circle);
  return {
    locale,
    viewer,
    circle,
    seat: { circleId: circle.circle.id, memberId: circle.viewer.memberId, role: circle.viewer.role },
    // Back to the screen asked for, or the first one the role may open, so the notice is seen.
    back: (wanted, notice) => back(locale, sections.includes(wanted) ? wanted : (sections[0] ?? wanted), notice),
  };
}

function back(locale: Locale, section: DashboardSection, notice: Notice): never {
  // The frame shows counts and the pause too, so it is read again, not only the page.
  revalidatePath("/[locale]/dashboard", "layout");
  redirect(withNotice(localizedPath(locale, dashboardRoutes[section]), notice));
}

/** A yes or a no to a proposal, decided by the approval engine. */
export async function answerProposalAction(form: FormData): Promise<void> {
  const { locale, viewer, circle, seat } = await acting(form, "approvals");
  const proposalId = formText(form, "proposal");
  const decision = form.get("decision");
  if (!proposalId || (decision !== "approve" && decision !== "reject")) back(locale, "approvals", "refused");
  if (!may(circle, "proposal.answer")) back(locale, "approvals", "refused");
  // A real payment needs a fresh multi-factor check before any yes counts
  // (AGENTS.md section 6). That check arrives with payments, so until then
  // only the demo's simulated money can be answered.
  if (!circle.circle.demo) back(locale, "approvals", "freshCheck");
  let outcome: Notice;
  try {
    const result = await asPerson(databases().app, viewer.userId, (tx) =>
      answerProposal(tx, seat, { proposalId, decision, method: "app", now: circle.circle.now, pausedUntil: circle.circle.pausedUntil }),
    );
    outcome = result === "approved" ? "approved" : result === "rejected" ? "rejected" : "answered";
  } catch (error) {
    if (!(error instanceof ProposalClosedError)) throw error;
    outcome = "closed";
  }
  back(locale, "approvals", outcome);
}

/** The pause switch: no proposal is approved for 24 hours on the circle's clock. */
export async function pauseAction(form: FormData): Promise<void> {
  const { viewer, circle, seat, back: to } = await acting(form, "overview");
  if (!may(circle, "circle.pause")) to("overview", "refused");
  const until = new Date(circle.circle.now.getTime() + PAUSE_HOURS * HOUR_MS);
  await asPerson(databases().app, viewer.userId, (tx) => pauseCircle(tx, seat, until));
  to("overview", "paused");
}

/** Lifts the pause early. The database allows the organizer or the one who paused. */
export async function resumeAction(form: FormData): Promise<void> {
  const { viewer, circle, seat, back: to } = await acting(form, "overview");
  const lifts = circle.viewer.role === "organizer" || circle.circle.pausedBy === seat.memberId;
  if (!lifts) to("overview", "refused");
  await asPerson(databases().app, viewer.userId, (tx) => resumeCircle(tx, seat));
  to("overview", "resumed");
}

/** An organizer invites someone, by email, to a role. */
export async function inviteAction(form: FormData): Promise<void> {
  const { locale, viewer, circle, seat } = await acting(form, "circle");
  if (!may(circle, "member.invite")) back(locale, "circle", "refused");
  const email = formText(form, "email", 254)?.toLowerCase() ?? null;
  const role = CIRCLE_ROLES.find((each) => each === form.get("role")) ?? null;
  if (email === null || !EMAIL.test(email) || role === null) back(locale, "circle", "invalidInvite");
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * HOUR_MS);
  await asPerson(databases().app, viewer.userId, (tx) => inviteMember(tx, seat, { email, role: role satisfies CircleRole, expiresAt }));
  back(locale, "circle", "invited");
}

/** A person who signed in starts their own circle and organizes it. */
export async function createCircleAction(form: FormData): Promise<void> {
  const locale = formLocale(form);
  const viewer = await requireViewer(localizedPath(locale, dashboardRoutes.overview));
  // The demo has its circle already; only a person who signed in starts one.
  if (viewer.kind !== "person") redirect(localizedPath(locale, dashboardRoutes.overview));
  const parentName = formText(form, "parentName", 80);
  const name = formText(form, "name", 80);
  const timezone = formText(form, "timezone", 64);
  const parentLevel = PARENT_LEVELS.find((each) => each === form.get("parentLevel")) ?? null;
  const known = timezone !== null && Intl.supportedValuesOf("timeZone").includes(timezone);
  if (parentName === null || name === null || !known || parentLevel === null) {
    redirect(withNotice(localizedPath(locale, dashboardRoutes.overview), "invalidCircle"));
  }
  await asPerson(databases().app, viewer.userId, (tx) =>
    createCircle(tx, {
      name,
      timezone,
      currency: CIRCLE_CURRENCY,
      parentName,
      parentLevel: parentLevel satisfies ParentLevel,
      relationship: formText(form, "relationship", 60),
    }),
  );
  revalidatePath("/[locale]/dashboard", "layout");
  redirect(withNotice(localizedPath(locale, dashboardRoutes.overview), "circleCreated"));
}
