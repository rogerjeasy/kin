import { DELEGATION_SCOPES, type DelegationScope } from "@kin/domain";
import { createHash, randomBytes } from "node:crypto";

import { authorize, type AccessDecision, type CircleAction, type Seat } from "./circle-access.ts";

export { DELEGATION_SCOPES };
export type { DelegationScope };

/**
 * Delegations: a member lets their own AI assistant work with the circle on
 * their behalf (docs/architecture.md section 13.4). A delegation is scoped,
 * expires and can be revoked, in the spirit of an AP2 intent mandate. Its
 * scope can only narrow what the member's own role allows, never widen it:
 * a delegated call is allowed only when the member could take the action
 * themselves and the scope also lists it.
 *
 * No scope lists an action that answers a proposal, pays, contributes,
 * signs, grants a standing permission or changes where money goes. Those are
 * done by a person, in Kin, with a fresh multi-factor check where money
 * moves; an assistant can at most raise a proposal that waits for them.
 */

/** The actions that only read: what the record says, never a change to it. */
const READ_ACTIONS = ["circle.view", "money.view", "own_payments.view", "safety.view", "shift.view", "care_agreement.view", "claim.check"] as const satisfies readonly CircleAction[];

/** Raising a proposal that still waits for the yeses the family agreement names. Proposing buys nothing. */
const PROPOSE_ACTIONS = ["refill.propose"] as const satisfies readonly CircleAction[];

export const DELEGATION_SCOPE_ACTIONS: Readonly<Record<DelegationScope, readonly CircleAction[]>> = {
  read: READ_ACTIONS,
  propose: [...READ_ACTIONS, ...PROPOSE_ACTIONS],
};

/** The OAuth-style scope string each delegation scope is announced as, to an MCP client. */
export const DELEGATION_OAUTH_SCOPES: Readonly<Record<DelegationScope, string>> = { read: "kin:read", propose: "kin:propose" };

export type DelegatedDecision = AccessDecision | { readonly allowed: false; readonly reason: "scope" };

export function isDelegationScope(value: unknown): value is DelegationScope {
  return typeof value === "string" && (DELEGATION_SCOPES as readonly string[]).includes(value);
}

/**
 * Whether an assistant acting under a delegation with `scope` may take
 * `action` for the member in `seat`. The member's own role is asked first, by
 * the one `authorize`; the scope can then only refuse.
 */
export function authorizeDelegated(seat: Seat | null, scope: DelegationScope, action: CircleAction): DelegatedDecision {
  const own = authorize(seat, action);
  if (!own.allowed) return own;
  return DELEGATION_SCOPE_ACTIONS[scope].includes(action) ? { allowed: true } : { allowed: false, reason: "scope" };
}

/** A delegation lasts at least an hour and at most this many days; then the member grants a new one. */
export const MAX_DELEGATION_DAYS = 90;
export const MIN_DELEGATION_MINUTES = 60;
/** The lifetimes a member chooses from on the screen, in days. */
export const DELEGATION_LIFETIME_DAYS = [1, 7, 30, 90] as const;
/** A member holds at most this many live delegations at once. */
export const MAX_LIVE_DELEGATIONS = 5;
/** The live console's delegation, issued only in a demo circle, lasts this long. */
export const CONSOLE_DELEGATION_MINUTES = 15;
/** The longest name a member gives their assistant. */
export const MAX_DELEGATION_LABEL = 60;

const TOKEN_PREFIX = "kin_dlg_";
const TOKEN_SHAPE = /^kin_dlg_[A-Za-z0-9_-]{43}$/u;

/**
 * A new delegation token: 32 random bytes as base64url behind a prefix that
 * says what it is, so a leaked one is recognisable to secret scanners. Kin
 * shows it once and keeps only its SHA-256.
 */
export const newDelegationToken = (): string => `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

/** The SHA-256 of a token in lowercase hex: all the database ever holds of it. */
export const hashDelegationToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** The last four characters, which the screen shows so a member can tell their tokens apart. */
export const delegationTokenHint = (token: string): string => token.slice(-4);

/**
 * The delegation token an `Authorization` header carries, or `null`: the
 * bearer scheme (in any case, as RFC 6750 allows) and a token of Kin's shape.
 * A token in a URL is never read (the MCP authorization rules forbid it).
 */
export function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^bearer +(\S+)\s*$/iu.exec(header);
  const token = match?.[1];
  return token !== undefined && TOKEN_SHAPE.test(token) ? token : null;
}
