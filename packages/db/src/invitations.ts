import { CIRCLE_ROLES, type CircleRole } from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { postgresError } from "./caregiver-billing.ts";
import type { Database, Transaction } from "./connection.ts";
import type { Seat } from "./operations.ts";
import { auditLog, circles, invitations, members } from "./schema/index.ts";

/**
 * Invitations to a circle (docs/architecture.md section 12.3). An organizer's
 * invitation to a real circle is emailed by Kin's worker with a link whose
 * token only the outbox message carries; the database keeps its SHA-256. The
 * link shows who invited whom and nothing else: joining needs a sign-in with
 * the verified address. SQLSTATE codes are listed in 0064_invitation-email.sql.
 */

/** The outbox topic of an invitation's email (written by kin_private.invite_member). */
export const INVITATION_EMAIL_TOPIC = "invitation.email";

export type InvitationReason = "refused" | "invalid" | "too_many" | "already_invited" | "already_member";

export class InvitationError extends Error {
  readonly retryable = false;
  readonly reason: InvitationReason;

  constructor(reason: InvitationReason, cause?: unknown) {
    super(`An invitation was refused: ${reason}`, { cause });
    this.name = "InvitationError";
    this.reason = reason;
  }
}

const REASONS: Readonly<Record<string, InvitationReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  KI001: "too_many",
  KI002: "already_invited",
  KI003: "already_member",
};

async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new InvitationError(reason, error);
    throw error;
  }
}

export type NewInvitation = {
  readonly email: string;
  readonly role: CircleRole;
  readonly expiresAt: Date;
  /** The language the email is written in: the inviter's. */
  readonly locale: string;
  /** A fresh token (`newCheckToken`). The email's link carries it; the database keeps only its hash, and none in a demo circle. */
  readonly token: string;
};

/**
 * Records an organizer's invitation and, in a real circle, queues its email.
 * At most twenty a day for a circle, one waiting per address, and never to a
 * member. Run as the person, inside `asPerson`.
 */
export async function inviteMember(tx: Transaction, seat: Seat, invitation: NewInvitation): Promise<string> {
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.invite_member(${seat.circleId}::uuid, ${invitation.email}, ${invitation.role}::circle_role,
            ${invitation.expiresAt.toISOString()}::timestamptz, ${invitation.locale}, ${invitation.token}) as id`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("The database recorded no invitation");
    return id;
  });
}

export type InvitationLinkState = "open" | "accepted" | "closed";
export type InvitationLink = {
  readonly inviterFirstName: string;
  readonly parentFirstName: string;
  readonly role: CircleRole;
  readonly state: InvitationLinkState;
};

const LINK_STATES: readonly InvitationLinkState[] = ["open", "accepted", "closed"];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseLink(raw: unknown): InvitationLink {
  if (!isObject(raw)) throw new Error("The invitation link returned nothing");
  const { inviterFirstName, parentFirstName, role, state } = raw;
  const knownRole = CIRCLE_ROLES.find((each) => each === role);
  const knownState = LINK_STATES.find((each) => each === state);
  if (typeof inviterFirstName !== "string" || typeof parentFirstName !== "string" || !knownRole || !knownState) {
    throw new Error("The invitation link's answer is not one Kin knows");
  }
  return { inviterFirstName, parentFirstName, role: knownRole, state: knownState };
}

/** Looks at an invitation link without using it. Nobody signed in; an unknown token is `refused`. */
export function readInvitationLink(db: Database, token: string): Promise<InvitationLink> {
  return operation(() =>
    db.transaction(async (tx) => {
      const result = await tx.execute<{ status: unknown }>(sql`select kin_private.invitation_link_status(${token}) as status`);
      return parseLink(result.rows[0]?.status);
    }),
  );
}

/** What the worker needs to write one invitation's email. As the service for the invitation's circle. */
export type InvitationEmailFacts = {
  readonly email: string;
  readonly role: CircleRole;
  readonly expiresAt: Date;
  /** Still waiting to be accepted, unexpired, in an active real circle. */
  readonly open: boolean;
  readonly inviterName: string;
  readonly parentName: string;
};

export async function readInvitationEmailFacts(tx: Transaction, circleId: string, invitationId: string): Promise<InvitationEmailFacts | null> {
  const [row] = await tx
    .select({
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      demo: circles.demo,
      circleStatus: circles.status,
      inviterName: members.displayName,
      parentName: sql<string | null>`(select m.display_name from members m where m.circle_id = ${invitations.circleId} and m.role = 'parent' and m.status = 'active' order by m.joined_at limit 1)`,
    })
    .from(invitations)
    .innerJoin(circles, eq(circles.id, invitations.circleId))
    .innerJoin(members, and(eq(members.circleId, invitations.circleId), eq(members.id, invitations.invitedBy)))
    .where(and(eq(invitations.circleId, circleId), eq(invitations.id, invitationId)));
  if (row === undefined) return null;
  const open = row.status === "pending" && !row.demo && row.circleStatus === "active" && row.expiresAt.getTime() > Date.now();
  return { email: row.email, role: row.role, expiresAt: row.expiresAt, open, inviterName: row.inviterName, parentName: row.parentName ?? "" };
}

/** The email went out: written down in the circle's audit, with no address. As the service for the invitation's circle. */
export async function recordInvitationEmailed(tx: Transaction, circleId: string, invitationId: string): Promise<void> {
  await tx.insert(auditLog).values({ id: randomUUID(), circleId, actor: "service", action: "invitation.emailed", subjectType: "invitation", subjectId: invitationId, origin: "worker" });
}
