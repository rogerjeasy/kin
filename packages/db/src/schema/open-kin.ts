import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { DELEGATION_SCOPES, SHIFT_KINDS } from "@kin/domain";

import { at, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { proposals } from "./approvals.ts";

/**
 * Open Kin: a member's own AI assistant, and a home-care agency's software,
 * working with the circle from outside (docs/architecture.md section 13.4 and
 * 13.5). Neither can approve. Kin keeps only the SHA-256 of every token and
 * secret, and every write is an operation in `kin_private`.
 */

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** What a tool call through Kin's MCP server came to: the gateway's outcomes in packages/agent, held a second time here. */
export const DELEGATION_CALL_OUTCOMES = ["ok", "unknown_tool", "refused", "invalid", "limit", "failed", "timeout", "too_large"] as const;
export type DelegationCallOutcome = (typeof DELEGATION_CALL_OUTCOMES)[number];

/** Whether Kin took an agency's report: kept as evidence, or kept only as the body it refused. */
export const AGENCY_REPORT_STATES = ["accepted", "refused"] as const;
export const AGENCY_REPORT_REFUSALS = ["shape", "times"] as const;

/**
 * A member's permission for their own assistant (Claude, ChatGPT, any MCP
 * client) to read the circle as them, and in the propose scope to raise a
 * proposal that waits for the family. It expires, and the member or the
 * organizer can revoke it; revoking takes effect on the next call. The token
 * is shown once; this row holds its SHA-256 and last four characters.
 */
export const delegations = pgTable(
  "delegations",
  {
    id: id(),
    circleId: circleId(),
    /** The member who granted it, and as whom the assistant reads. */
    memberId: uuid("member_id").notNull(),
    /** What the member calls their assistant: "Marcus's Claude". */
    label: text("label").notNull(),
    scope: text("scope", { enum: DELEGATION_SCOPES }).notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    /** The live console's short delegation, which Kin issues only in a demo circle. */
    console: boolean("console").notNull().default(false),
    /** A sample the demo provisioner wrote, with no token anyone holds. The screen says so. */
    seeded: boolean("seeded").notNull().default(false),
    /** The OAuth client the member authorized in the browser (decision 112); null for a token copied from the screen. */
    oauthClient: text("oauth_client"),
    expiresAt: at("expires_at").notNull(),
    revokedAt: at("revoked_at"),
    revokedBy: uuid("revoked_by"),
    lastUsedAt: at("last_used_at"),
    uses: integer("uses").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "delegations_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "delegations_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "delegations_revoked_by_fk", columns: [t.circleId, t.revokedBy], foreignColumns: [members.circleId, members.id] }),
    unique("delegations_circle_row").on(t.circleId, t.id),
    uniqueIndex("delegations_token").on(t.tokenHash),
    index("delegations_member_idx").on(t.circleId, t.memberId),
    check("delegations_scope", sql.raw(`scope in (${quoted(DELEGATION_SCOPES)})`)),
    check("delegations_label", sql`length(btrim(${t.label})) between 1 and 60 and ${t.label} !~ '[<>{}\\n\\r]'`),
    check("delegations_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("delegations_hint", sql`${t.tokenHint} ~ '^[A-Za-z0-9_-]{4}$'`),
    check("delegations_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
    check("delegations_revoked", sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
    check("delegations_uses", sql`${t.uses} >= 0`),
    check("delegations_oauth_client", sql`${t.oauthClient} is null or length(${t.oauthClient}) between 1 and 2048`),
  ],
);

/** How long an authorization code lives between the consent screen and the client's trade for a token. */
export const OAUTH_CODE_SECONDS = 60;

/**
 * A single-use OAuth authorization code (decision 112): the member's yes on
 * the consent screen, bound to the client, its redirect URI, its PKCE
 * challenge, the resource, and the scope and lifetime the member chose. It
 * lives sixty seconds, is traded once for a delegation, and holds only the
 * code's SHA-256. A code presented a second time revokes what it was traded for.
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: id(),
    circleId: circleId(),
    /** The member who said yes, and as whom the delegation reads. */
    memberId: uuid("member_id").notNull(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull(),
    /** The name the client gave itself, as the member saw it; it becomes the delegation's label. */
    clientName: text("client_name").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope", { enum: DELEGATION_SCOPES }).notNull(),
    days: integer("days").notNull(),
    resource: text("resource").notNull(),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
    usedAt: at("used_at"),
    delegationId: uuid("delegation_id"),
  },
  (t) => [
    foreignKey({ name: "oauth_codes_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "oauth_codes_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "oauth_codes_delegation_fk", columns: [t.circleId, t.delegationId], foreignColumns: [delegations.circleId, delegations.id] }),
    uniqueIndex("oauth_codes_code").on(t.codeHash),
    index("oauth_codes_member_idx").on(t.circleId, t.memberId, t.createdAt),
    check("oauth_codes_hash", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("oauth_codes_challenge", sql`${t.codeChallenge} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("oauth_codes_scope", sql.raw(`scope in (${quoted(DELEGATION_SCOPES)})`)),
    check("oauth_codes_days", sql`${t.days} in (1, 7, 30, 90)`),
    check("oauth_codes_client", sql`length(${t.clientId}) between 1 and 2048`),
    check("oauth_codes_client_name", sql`length(btrim(${t.clientName})) between 1 and 60 and ${t.clientName} !~ '[<>{}\\n\\r]'`),
    check("oauth_codes_redirect", sql`length(${t.redirectUri}) between 1 and 512`),
    check("oauth_codes_resource", sql`length(${t.resource}) between 1 and 512`),
    check("oauth_codes_expiry", sql.raw(`expires_at > created_at and expires_at <= created_at + interval '${OAUTH_CODE_SECONDS} seconds'`)),
    check("oauth_codes_used", sql`${t.delegationId} is null or ${t.usedAt} is not null`),
  ],
);

/**
 * One tool call an assistant made under a delegation, whatever came of it:
 * the name it asked for (only if a screen can show it safely), the gateway's
 * outcome, and any proposal it raised. Never the arguments or the result.
 */
export const delegationCalls = pgTable(
  "delegation_calls",
  {
    id: id(),
    circleId: circleId(),
    delegationId: uuid("delegation_id").notNull(),
    tool: text("tool").notNull(),
    outcome: text("outcome", { enum: DELEGATION_CALL_OUTCOMES }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    proposalId: uuid("proposal_id"),
    at: at("at").notNull(),
  },
  (t) => [
    foreignKey({ name: "delegation_calls_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "delegation_calls_delegation_fk", columns: [t.circleId, t.delegationId], foreignColumns: [delegations.circleId, delegations.id] }),
    foreignKey({ name: "delegation_calls_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    index("delegation_calls_delegation_idx").on(t.circleId, t.delegationId, t.at),
    check("delegation_calls_tool", sql`${t.tool} ~ '^([A-Za-z0-9_.-]{1,64}|\\[unreadable\\])$'`),
    check("delegation_calls_outcome", sql.raw(`outcome in (${quoted(DELEGATION_CALL_OUTCOMES)})`)),
    check("delegation_calls_duration", sql`${t.durationMs} between 0 and 600000`),
    check("delegation_calls_proposal_only_ok", sql`${t.proposalId} is null or ${t.outcome} = 'ok'`),
  ],
);

/**
 * A home-care agency's key to report visits for this circle, created by the
 * organizer. The agency signs each request with the key's secret, which Kin
 * shows once and derives again from its own signing key; this row holds the
 * public ID and the secret's SHA-256 only.
 */
export const agencyKeys = pgTable(
  "agency_keys",
  {
    id: id(),
    circleId: circleId(),
    /** The agency's name, as the organizer wrote it. */
    label: text("label").notNull(),
    keyId: text("key_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    seeded: boolean("seeded").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    revokedAt: at("revoked_at"),
    revokedBy: uuid("revoked_by"),
    lastUsedAt: at("last_used_at"),
  },
  (t) => [
    foreignKey({ name: "agency_keys_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "agency_keys_created_by_fk", columns: [t.circleId, t.createdBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "agency_keys_revoked_by_fk", columns: [t.circleId, t.revokedBy], foreignColumns: [members.circleId, members.id] }),
    unique("agency_keys_circle_row").on(t.circleId, t.id),
    uniqueIndex("agency_keys_key_id").on(t.keyId),
    check("agency_keys_label", sql`length(btrim(${t.label})) between 1 and 80 and ${t.label} !~ '[<>{}\\n\\r]'`),
    check("agency_keys_key_shape", sql`${t.keyId} ~ '^agk_[A-Za-z0-9_-]{22}$'`),
    check("agency_keys_hash", sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
    check("agency_keys_revoked", sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
  ],
);

/**
 * A visit an agency reported, as evidence beside Kin's own shift. The raw body
 * is kept first, as it arrived and was verified; a body Kin could not read is
 * kept as refused, with why. A report pays nothing and changes no shift.
 */
export const agencyVisitReports = pgTable(
  "agency_visit_reports",
  {
    id: id(),
    circleId: circleId(),
    agencyKeyId: uuid("agency_key_id").notNull(),
    rawBody: text("raw_body").notNull(),
    bodySha256: text("body_sha256").notNull(),
    state: text("state", { enum: AGENCY_REPORT_STATES }).notNull(),
    refusal: text("refusal", { enum: AGENCY_REPORT_REFUSALS }),
    externalId: text("external_id"),
    caregiverName: text("caregiver_name"),
    /** The circle's caregiver the name matched, when exactly one did. */
    caregiverMemberId: uuid("caregiver_member_id"),
    kind: text("kind", { enum: SHIFT_KINDS }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    checkedInAt: at("checked_in_at"),
    checkedOutAt: at("checked_out_at"),
    minutes: integer("minutes"),
    note: text("note"),
    seeded: boolean("seeded").notNull().default(false),
    receivedAt: at("received_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ name: "agency_visit_reports_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "agency_visit_reports_key_fk", columns: [t.circleId, t.agencyKeyId], foreignColumns: [agencyKeys.circleId, agencyKeys.id] }),
    foreignKey({ name: "agency_visit_reports_caregiver_fk", columns: [t.circleId, t.caregiverMemberId], foreignColumns: [members.circleId, members.id] }),
    unique("agency_visit_reports_circle_row").on(t.circleId, t.id),
    uniqueIndex("agency_visit_reports_external").on(t.agencyKeyId, t.externalId).where(sql`${t.externalId} is not null`),
    index("agency_visit_reports_received_idx").on(t.circleId, t.receivedAt),
    check("agency_visit_reports_body", sql`length(${t.rawBody}) between 1 and 16384`),
    check("agency_visit_reports_sha", sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`),
    check("agency_visit_reports_state", sql.raw(`state in (${quoted(AGENCY_REPORT_STATES)})`)),
    check("agency_visit_reports_kind", sql.raw(`kind is null or kind in (${quoted(SHIFT_KINDS)})`)),
    // An accepted report has every field of a visit; a refused one says only why.
    check(
      "agency_visit_reports_accepted",
      sql`(${t.state} = 'accepted') = (${t.refusal} is null)
        and (${t.state} = 'refused' or (${t.externalId} is not null and ${t.caregiverName} is not null and ${t.kind} is not null and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.minutes} is not null))
        and (${t.state} = 'accepted' or (${t.externalId} is null and ${t.caregiverMemberId} is null))`,
    ),
    check("agency_visit_reports_refusal", sql.raw(`refusal is null or refusal in (${quoted(AGENCY_REPORT_REFUSALS)})`)),
    check("agency_visit_reports_minutes", sql`${t.minutes} is null or ${t.minutes} between 1 and 1440`),
    check("agency_visit_reports_times", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check("agency_visit_reports_note", sql`${t.note} is null or (length(${t.note}) <= 280 and ${t.note} !~ '[<>{}\\n\\r]')`),
  ],
);
