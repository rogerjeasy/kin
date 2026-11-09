import {
  CONSOLE_DELEGATION_MINUTES,
  DELEGATION_LIFETIME_DAYS,
  MAX_DELEGATION_LABEL,
  authorize,
  delegationTokenHint,
  hashDelegationToken,
  isDelegationScope,
  newDelegationToken,
  type DelegationScope,
} from "@kin/auth";
import {
  OpenKinError,
  asPerson,
  grantDelegation,
  readAgencyKeys,
  readAgencyReports,
  readDelegations,
  revokeDelegation,
  type AgencyKeyRecord,
  type AgencyReportRecord,
  type CircleSnapshot,
  type Database,
  type DelegationRecord,
  type OpenKinReason,
} from "@kin/db";

import { MCP_PATH } from "./mcp";

/**
 * The "Connected assistants" screen's operations and reads. A member grants
 * their own assistant a delegation (the token is shown once), revokes it, and
 * in a demo circle asks for the live console's short delegation, which the
 * browser then uses to play a real MCP session against the real endpoint.
 */

export type ConnectionsContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot; readonly origin: string; readonly now?: () => number };

export type ConnectionResult =
  | { readonly ok: true; readonly id: string; readonly token: string; readonly hint: string; readonly endpoint: string }
  | { readonly ok: true; readonly revoked: boolean }
  | { readonly ok: false; readonly reason: "refused" | "invalid" | "demo_only" | "too_many" };

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LABEL = /^[^<>{}\n\r]+$/u;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (row: Record<string, unknown>, allowed: readonly string[]) => Object.keys(row).every((key) => allowed.includes(key));

type Parsed =
  | { readonly operation: "grant"; readonly label: string; readonly scope: DelegationScope; readonly days: number }
  | { readonly operation: "revoke"; readonly id: string }
  | { readonly operation: "console" };

/** One operation of the screen, or `null` for anything else. Nothing is trimmed into shape but the label's ends. */
export function parseConnection(input: unknown): Parsed | null {
  if (!isRecord(input)) return null;
  const { operation } = input;
  if (operation === "grant" && onlyKeys(input, ["operation", "label", "scope", "days"])) {
    const { label, scope, days } = input;
    if (typeof label !== "string" || !LABEL.test(label) || label.trim() === "" || label.trim().length > MAX_DELEGATION_LABEL) return null;
    if (!isDelegationScope(scope) || typeof days !== "number" || !(DELEGATION_LIFETIME_DAYS as readonly number[]).includes(days)) return null;
    return { operation, label: label.trim(), scope, days };
  }
  if (operation === "revoke" && onlyKeys(input, ["operation", "id"])) return typeof input["id"] === "string" && UUID.test(input["id"]) ? { operation, id: input["id"] } : null;
  if (operation === "console" && onlyKeys(input, ["operation"])) return { operation };
  return null;
}

function refusal(reason: OpenKinReason): ConnectionResult {
  if (reason === "too_many" || reason === "demo_only" || reason === "invalid") return { ok: false, reason };
  return { ok: false, reason: "refused" };
}

/** The one request boundary for the screen's writes: the role through `authorize`, the shape here, the rest in the database. */
export async function manageConnection(context: ConnectionsContext, input: unknown): Promise<ConnectionResult> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "delegation.grant").allowed) return { ok: false, reason: "refused" };
  const parsed = parseConnection(input);
  if (parsed === null) return { ok: false, reason: "invalid" };
  const circleId = circle.circle.id;
  const now = (context.now ?? Date.now)();
  try {
    if (parsed.operation === "revoke") {
      return { ok: true, revoked: await asPerson(context.db, context.userId, (tx) => revokeDelegation(tx, { circleId, delegationId: parsed.id })) };
    }
    // The console is a demo's way to watch a real session without copying a token: never in a real circle.
    if (parsed.operation === "console" && !circle.circle.demo) return { ok: false, reason: "demo_only" };
    const token = newDelegationToken();
    const grant =
      parsed.operation === "console"
        ? { label: "Live console", scope: "propose" as const, expiresAt: new Date(now + CONSOLE_DELEGATION_MINUTES * 60_000), console: true }
        : { label: parsed.label, scope: parsed.scope, expiresAt: new Date(now + parsed.days * DAY_MS), console: false };
    const id = await asPerson(context.db, context.userId, (tx) => grantDelegation(tx, { circleId, tokenHash: hashDelegationToken(token), tokenHint: delegationTokenHint(token), ...grant }));
    return { ok: true, id, token, hint: delegationTokenHint(token), endpoint: `${context.origin}${MCP_PATH}` };
  } catch (error) {
    if (error instanceof OpenKinError) return refusal(error.reason);
    throw error;
  }
}

export type ConnectionsScreen = { readonly delegations: readonly DelegationRecord[]; readonly agencyKeys: readonly AgencyKeyRecord[]; readonly reports: readonly AgencyReportRecord[] };

/** What the screen shows, read as the person: row-level security decides which rows. */
export function connectionsScreen(context: Pick<ConnectionsContext, "db" | "userId" | "circle">): Promise<ConnectionsScreen> {
  const circleId = context.circle.circle.id;
  return asPerson(context.db, context.userId, async (tx) => ({
    delegations: await readDelegations(tx, circleId),
    agencyKeys: await readAgencyKeys(tx, circleId),
    reports: await readAgencyReports(tx, circleId),
  }));
}
