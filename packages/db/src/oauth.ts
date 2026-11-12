import type { DelegationScope } from "@kin/domain";
import { DELEGATION_SCOPES } from "@kin/domain";
import { sql } from "drizzle-orm";

import { postgresError } from "./caregiver-billing.ts";
import type { Database, Transaction } from "./connection.ts";

/**
 * OAuth 2.1 for Kin's MCP server (docs/architecture.md section 13.4,
 * decision 112). The member's yes on the consent screen becomes a short,
 * single-use code; the client trades it once for a delegation. Both are
 * operations in `kin_private` (migration 0071): the database keeps only
 * hashes and decides every refusal.
 */

/**
 * `refused`: the person may not authorize a client (an observer, or no seat).
 * `demo_only`: OAuth connects real circles only. `too_many`: five live delegations already.
 * `too_many_codes`: too many consents in ten minutes. `invalid`: the input does not fit the table.
 */
export type OAuthConsentRefusal = "refused" | "demo_only" | "too_many" | "too_many_codes" | "invalid";

/** The member's consent could not be kept. Retrying the same request cannot help. */
export class OAuthConsentError extends Error {
  readonly retryable = false;
  readonly reason: OAuthConsentRefusal;

  constructor(reason: OAuthConsentRefusal) {
    super(`OAuth consent refused: ${reason}`);
    this.name = "OAuthConsentError";
    this.reason = reason;
  }
}

// SQLSTATE codes are listed in migration 0071_oauth-access.sql.
const REASONS: Readonly<Record<string, OAuthConsentRefusal>> = {
  "42501": "refused",
  KO001: "demo_only",
  KD001: "too_many",
  KO002: "too_many_codes",
  "23514": "invalid",
  "22P02": "invalid",
  "22001": "invalid",
  "23505": "invalid",
};

export type AuthorizationCodeInput = {
  readonly circleId: string;
  readonly codeHash: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: DelegationScope;
  readonly days: number;
  readonly resource: string;
};

/** Keeps the member's yes as a code that lives sixty seconds. Run as the person, inside `asPerson`. */
export async function createAuthorizationCode(tx: Transaction, input: AuthorizationCodeInput): Promise<void> {
  try {
    await tx.execute(sql`select kin_private.create_oauth_code(${input.circleId}::uuid, ${input.codeHash}, ${input.clientId}, ${input.clientName}, ${input.redirectUri},
      ${input.codeChallenge}, ${input.scope}, ${input.days}::integer, ${input.resource})`);
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new OAuthConsentError(reason);
    throw error;
  }
}

export type RedeemInput = {
  readonly codeHash: string;
  readonly clientId: string;
  /** The redirect URI the client sent again, or null when it left it out. */
  readonly redirectUri: string | null;
  /** The S256 challenge computed from the verifier the client sent. */
  readonly codeChallenge: string;
  readonly resource: string;
  readonly tokenHash: string;
  readonly tokenHint: string;
};

/** What trading a code came to: the delegation it became, or an OAuth error code and nothing about why. */
export type Redeemed =
  | { readonly ok: true; readonly delegationId: string; readonly scope: DelegationScope; readonly expiresAt: Date }
  | { readonly ok: false; readonly error: "invalid_grant" | "invalid_target" | "too_many" };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseRedeemed(raw: unknown): Redeemed {
  if (!isObject(raw)) throw new Error("Trading the authorization code returned nothing");
  const error = raw["error"];
  if (error === "invalid_grant" || error === "invalid_target" || error === "too_many") return { ok: false, error };
  const { delegationId, scope, expiresAt } = raw;
  if (typeof delegationId !== "string" || typeof expiresAt !== "string" || !(DELEGATION_SCOPES as readonly unknown[]).includes(scope)) throw new Error("Trading the authorization code returned an unknown shape");
  return { ok: true, delegationId, scope: scope as DelegationScope, expiresAt: new Date(expiresAt) };
}

/** Trades a code for a delegation whose token's hash the caller made. Runs with nobody signed in, in one transaction. */
export async function redeemAuthorizationCode(db: Database, input: RedeemInput): Promise<Redeemed> {
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ redeemed: unknown }>(
      sql`select kin_private.redeem_oauth_code(${input.codeHash}, ${input.clientId}, ${input.redirectUri}, ${input.codeChallenge}, ${input.resource}, ${input.tokenHash}, ${input.tokenHint}) as redeemed`,
    );
    return parseRedeemed(result.rows[0]?.redeemed);
  });
}
