import type { CircleRole, DelegationScope, ShiftKind, VisitReport, VisitReportRefusal } from "@kin/domain";
import { CIRCLE_ROLES, DELEGATION_SCOPES } from "@kin/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { postgresError } from "./caregiver-billing.ts";
import type { Database, Transaction } from "./connection.ts";
import { agencyKeys, agencyVisitReports, delegationCalls, delegations, type DelegationCallOutcome } from "./schema/index.ts";

/**
 * Open Kin's records (docs/architecture.md sections 13.4 and 13.5): the
 * delegations members grant their own assistants, the calls those assistants
 * make, agencies' keys and the visits they report. Every write is an
 * operation in `kin_private` (migration 0057); the database keeps only the
 * SHA-256 of a token or a secret.
 */

/**
 * `refused`: the person may not, or the token or key is not live.
 * `invalid`: the request is not one the table can hold.
 * `too_many`: five live delegations already. `demo_only`: the live console is for demo circles.
 * `conflict`: an agency sent this visit's ID before with another body.
 * `too_many_reports`: a key reported more visits today than an agency ever needs.
 * `too_many_keys`: five live agency keys already.
 * `invoice_conflict`: an agency sent this invoice number before with another body.
 * `too_many_invoices`: a key sent more invoices today than an agency ever needs.
 */
export type OpenKinReason = "refused" | "invalid" | "too_many" | "demo_only" | "conflict" | "too_many_reports" | "too_many_keys" | "invoice_conflict" | "too_many_invoices";

/** An Open Kin operation was refused. Retrying the same request cannot help. */
export class OpenKinError extends Error {
  readonly retryable = false;
  readonly reason: OpenKinReason;

  constructor(reason: OpenKinReason) {
    super(`Open Kin operation refused: ${reason}`);
    this.name = "OpenKinError";
    this.reason = reason;
  }
}

// SQLSTATE codes are listed in migration 0057_open-kin-access.sql.
const REASONS: Readonly<Record<string, OpenKinReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  "22007": "invalid",
  "22008": "invalid",
  "22001": "invalid",
  "23503": "invalid",
  KD001: "too_many",
  KD002: "demo_only",
  KA001: "conflict",
  KA002: "too_many_reports",
  KA003: "too_many_keys",
  KA004: "invoice_conflict",
  KA005: "too_many_invoices",
};

/** Runs one Open Kin operation, turning the database's coded refusals into an `OpenKinError`. */
export async function openKinOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new OpenKinError(reason);
    throw error;
  }
}

const requiredValue = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`The Open Kin operation returned no ${what}`);
  return value;
};

export type GrantDelegation = {
  readonly circleId: string;
  readonly label: string;
  readonly scope: DelegationScope;
  readonly tokenHash: string;
  readonly tokenHint: string;
  readonly expiresAt: Date;
  /** The live console's delegation, in a demo circle only. */
  readonly console: boolean;
};

/** Grants a delegation for the person's own seat and returns its ID. Run as the person, inside `asPerson`. */
export async function grantDelegation(tx: Transaction, input: GrantDelegation): Promise<string> {
  const result = await openKinOperation(() =>
    tx.execute<{ id: string }>(sql`select kin_private.grant_delegation(${input.circleId}::uuid, ${input.label}, ${input.scope}, ${input.tokenHash}, ${input.tokenHint},
      ${input.expiresAt.toISOString()}::timestamptz, ${input.console}) as id`),
  );
  return requiredValue(result.rows[0]?.id, "delegation");
}

/** Revokes a delegation: the person's own, or any for the organizer. Returns whether this call revoked it. */
export async function revokeDelegation(tx: Transaction, input: { readonly circleId: string; readonly delegationId: string }): Promise<boolean> {
  const result = await openKinOperation(() => tx.execute<{ revoked: boolean }>(sql`select kin_private.revoke_delegation(${input.circleId}::uuid, ${input.delegationId}::uuid) as revoked`));
  return result.rows[0]?.revoked === true;
}

export type DelegationCallRecord = { readonly id: string; readonly tool: string; readonly outcome: DelegationCallOutcome; readonly durationMs: number; readonly proposalId: string | null; readonly at: Date };

export type DelegationRecord = {
  readonly id: string;
  readonly memberId: string;
  readonly label: string;
  readonly scope: DelegationScope;
  readonly tokenHint: string;
  readonly console: boolean;
  readonly seeded: boolean;
  /** The OAuth client the member authorized in the browser, or null for a token copied from the screen. */
  readonly oauthClient: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly uses: number;
  readonly createdAt: Date;
  /** The newest calls first. */
  readonly calls: readonly DelegationCallRecord[];
};

/** How many calls a screen shows per delegation. */
export const DELEGATION_CALLS_SHOWN = 12;

/** The delegations the person may read, newest first, each with its latest calls. Row-level security decides which. */
export async function readDelegations(tx: Transaction, circleId: string): Promise<DelegationRecord[]> {
  const rows = await tx
    .select({
      id: delegations.id,
      memberId: delegations.memberId,
      label: delegations.label,
      scope: delegations.scope,
      tokenHint: delegations.tokenHint,
      console: delegations.console,
      seeded: delegations.seeded,
      oauthClient: delegations.oauthClient,
      expiresAt: delegations.expiresAt,
      revokedAt: delegations.revokedAt,
      lastUsedAt: delegations.lastUsedAt,
      uses: delegations.uses,
      createdAt: delegations.createdAt,
    })
    .from(delegations)
    .where(eq(delegations.circleId, circleId))
    .orderBy(desc(delegations.createdAt), desc(delegations.id));
  if (rows.length === 0) return [];
  const calls = await tx
    .select()
    .from(delegationCalls)
    .where(and(eq(delegationCalls.circleId, circleId), inArray(delegationCalls.delegationId, rows.map((row) => row.id))))
    .orderBy(desc(delegationCalls.at), desc(delegationCalls.id));
  const callsOf = Map.groupBy(calls, (call) => call.delegationId);
  return rows.map((row) => ({
    ...row,
    calls: (callsOf.get(row.id) ?? []).slice(0, DELEGATION_CALLS_SHOWN).map((call) => ({ id: call.id, tool: call.tool, outcome: call.outcome, durationMs: call.durationMs, proposalId: call.proposalId, at: call.at })),
  }));
}

/** The member a live token names, and how to read the circle as them. */
export type ResolvedDelegation = {
  readonly delegationId: string;
  readonly circleId: string;
  readonly memberId: string;
  readonly userId: string;
  readonly role: CircleRole;
  readonly scope: DelegationScope;
  /** The language the member reads Kin in. */
  readonly language: string;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseResolved(raw: unknown): ResolvedDelegation | null {
  if (!isObject(raw)) return null;
  const text = (key: string) => {
    const value = raw[key];
    if (typeof value !== "string") throw new Error(`The resolved delegation's ${key} is not text`);
    return value;
  };
  const role = text("role");
  const scope = text("scope");
  if (!(CIRCLE_ROLES as readonly string[]).includes(role) || !(DELEGATION_SCOPES as readonly string[]).includes(scope)) throw new Error("The resolved delegation has an unknown role or scope");
  return { delegationId: text("delegationId"), circleId: text("circleId"), memberId: text("memberId"), userId: text("userId"), role: role as CircleRole, scope: scope as DelegationScope, language: text("language") };
}

/**
 * The live delegation a token's SHA-256 names, counting the use, or `null` for
 * any token that is not live. Runs with nobody signed in, as the app's role,
 * in a plain transaction.
 */
export async function resolveDelegation(db: Database, tokenHash: string): Promise<ResolvedDelegation | null> {
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ resolved: unknown }>(sql`select kin_private.resolve_delegation(${tokenHash}) as resolved`);
    return parseResolved(result.rows[0]?.resolved);
  });
}

export type DelegationCallInput = { readonly tool: string; readonly outcome: DelegationCallOutcome; readonly durationMs: number; readonly proposalId: string | null; readonly at: Date };

/** Records the calls made under the delegation a token's SHA-256 names. Runs with nobody signed in. */
export async function recordDelegationCalls(db: Database, tokenHash: string, calls: readonly DelegationCallInput[]): Promise<void> {
  if (calls.length === 0) return;
  await db.transaction(async (tx) => {
    for (const call of calls) {
      await openKinOperation(() =>
        tx.execute(sql`select kin_private.record_delegation_call(${tokenHash}, ${call.tool}, ${call.outcome}, ${Math.min(call.durationMs, 600_000)}::integer,
          ${call.proposalId}::uuid, ${call.at.toISOString()}::timestamptz)`),
      );
    }
  });
}

/** The organizer creates an agency key from its public ID and its secret's SHA-256, and gets its row's ID. */
export async function createAgencyKey(tx: Transaction, input: { readonly circleId: string; readonly label: string; readonly keyId: string; readonly secretHash: string }): Promise<string> {
  const result = await openKinOperation(() => tx.execute<{ id: string }>(sql`select kin_private.create_agency_key(${input.circleId}::uuid, ${input.label}, ${input.keyId}, ${input.secretHash}) as id`));
  return requiredValue(result.rows[0]?.id, "agency key");
}

export async function revokeAgencyKey(tx: Transaction, input: { readonly circleId: string; readonly keyRowId: string }): Promise<boolean> {
  const result = await openKinOperation(() => tx.execute<{ revoked: boolean }>(sql`select kin_private.revoke_agency_key(${input.circleId}::uuid, ${input.keyRowId}::uuid) as revoked`));
  return result.rows[0]?.revoked === true;
}

export type AgencyKeyRecord = { readonly id: string; readonly label: string; readonly keyId: string; readonly seeded: boolean; readonly createdAt: Date; readonly revokedAt: Date | null; readonly lastUsedAt: Date | null };

export async function readAgencyKeys(tx: Transaction, circleId: string): Promise<AgencyKeyRecord[]> {
  return tx
    .select({ id: agencyKeys.id, label: agencyKeys.label, keyId: agencyKeys.keyId, seeded: agencyKeys.seeded, createdAt: agencyKeys.createdAt, revokedAt: agencyKeys.revokedAt, lastUsedAt: agencyKeys.lastUsedAt })
    .from(agencyKeys)
    .where(eq(agencyKeys.circleId, circleId))
    .orderBy(desc(agencyKeys.createdAt), desc(agencyKeys.id));
}

export type AgencyReportRecord = {
  readonly id: string;
  readonly agencyKeyId: string;
  readonly state: "accepted" | "refused";
  readonly refusal: VisitReportRefusal | null;
  readonly externalId: string | null;
  readonly caregiverName: string | null;
  readonly caregiverMemberId: string | null;
  readonly kind: ShiftKind | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly checkedInAt: Date | null;
  readonly checkedOutAt: Date | null;
  readonly minutes: number | null;
  readonly note: string | null;
  readonly seeded: boolean;
  readonly receivedAt: Date;
};

/** How many reports a screen shows. */
export const AGENCY_REPORTS_SHOWN = 20;

/** The visits agencies reported, newest first. Row-level security decides which the person reads; the raw body is not among them. */
export async function readAgencyReports(tx: Transaction, circleId: string): Promise<AgencyReportRecord[]> {
  return tx
    .select({
      id: agencyVisitReports.id,
      agencyKeyId: agencyVisitReports.agencyKeyId,
      state: agencyVisitReports.state,
      refusal: agencyVisitReports.refusal,
      externalId: agencyVisitReports.externalId,
      caregiverName: agencyVisitReports.caregiverName,
      caregiverMemberId: agencyVisitReports.caregiverMemberId,
      kind: agencyVisitReports.kind,
      startsAt: agencyVisitReports.startsAt,
      endsAt: agencyVisitReports.endsAt,
      checkedInAt: agencyVisitReports.checkedInAt,
      checkedOutAt: agencyVisitReports.checkedOutAt,
      minutes: agencyVisitReports.minutes,
      note: agencyVisitReports.note,
      seeded: agencyVisitReports.seeded,
      receivedAt: agencyVisitReports.receivedAt,
    })
    .from(agencyVisitReports)
    .where(eq(agencyVisitReports.circleId, circleId))
    .orderBy(desc(agencyVisitReports.receivedAt), desc(agencyVisitReports.id))
    .limit(AGENCY_REPORTS_SHOWN);
}

export type ReceivedVisit = { readonly id: string; readonly state: "accepted" | "refused"; readonly duplicate: boolean; readonly caregiverMatched: boolean };

/**
 * Keeps one visit an agency reported, under the live key whose public ID and
 * secret hash the caller verified the signature with. Runs with nobody signed
 * in. `report` is the domain's parsed report, or `null` with the refusal when
 * the body was not one; the raw body is kept either way.
 */
export async function receiveAgencyVisit(
  db: Database,
  input: { readonly keyId: string; readonly secretHash: string; readonly rawBody: string; readonly parsed: { readonly ok: true; readonly report: VisitReport } | { readonly ok: false; readonly reason: VisitReportRefusal } },
): Promise<ReceivedVisit> {
  const report = input.parsed.ok
    ? {
        externalId: input.parsed.report.externalId,
        caregiver: input.parsed.report.caregiver,
        kind: input.parsed.report.kind,
        startsAt: input.parsed.report.startsAt.toISOString(),
        endsAt: input.parsed.report.endsAt.toISOString(),
        checkedInAt: input.parsed.report.checkedInAt?.toISOString() ?? null,
        checkedOutAt: input.parsed.report.checkedOutAt?.toISOString() ?? null,
        minutes: input.parsed.report.minutes,
        note: input.parsed.report.note,
      }
    : null;
  const refusal = input.parsed.ok ? null : input.parsed.reason;
  return db.transaction(async (tx) => {
    const result = await openKinOperation(() =>
      tx.execute<{ received: unknown }>(sql`select kin_private.receive_agency_visit(${input.keyId}, ${input.secretHash}, ${input.rawBody}, ${report === null ? null : JSON.stringify(report)}::jsonb, ${refusal}) as received`),
    );
    const raw = result.rows[0]?.received;
    if (!isObject(raw) || typeof raw["id"] !== "string" || (raw["state"] !== "accepted" && raw["state"] !== "refused")) throw new Error("The agency visit was not kept");
    return { id: raw["id"], state: raw["state"], duplicate: raw["duplicate"] === true, caregiverMatched: raw["caregiverMatched"] === true };
  });
}
