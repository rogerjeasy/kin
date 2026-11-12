import { MAX_MCP_BODY_BYTES, handleMcpHttp, protectedResourceMetadata, toolGateway, type JsonValue, type McpCall, type McpCaller, type McpHttpResponse, type ToolOutcome } from "@kin/agent";
import { hashDelegationToken } from "@kin/auth";
import { asPerson, readCircle, readExecutions, recordDelegationCalls, resolveDelegation, type Database, type DelegationCallOutcome } from "@kin/db";

import { dashboardRoutes } from "@/content/dashboard-routes";
import { routes } from "@/content/site-routes";
import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale, isLocale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";

import { askKinTools, logToolCall } from "../ask-kin/tools";
import { askKinWorld, type PayPalReader } from "../ask-kin/world";
import { createRateLimiter, type RateLimiter } from "../model";
import { readCappedText } from "../request-body";

/**
 * Kin's MCP endpoint, wired to the circle (docs/architecture.md section 13.4).
 * The protocol and the boundary live in packages/agent; this file only turns
 * a delegation token into the member it names, reads the circle as them, and
 * keeps the record of each call. The token is accepted here and nowhere else:
 * no other route of Kin reads a bearer token, so a delegation can never reach
 * the screens where a person approves.
 */

// The two eras' outcome lists are one list: the gateway's, held a second time by the database.
type SameOutcomes = [ToolOutcome] extends [DelegationCallOutcome] ? ([DelegationCallOutcome] extends [ToolOutcome] ? true : never) : never;
export const OUTCOMES_AGREE: SameOutcomes = true;

export const MCP_PATH = "/api/mcp";
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

export type McpServices = {
  readonly db: Database;
  readonly origin: string;
  readonly paypal: PayPalReader | null;
  readonly limiter?: RateLimiter;
  readonly now?: () => number;
};

/** Each delegation may make sixty requests in ten minutes, from this server. Its tools read the database and call no model. */
export const mcpLimiter = createRateLimiter(60, 10 * 60 * 1000);

/** The protected resource metadata document for the MCP endpoint. */
export function mcpMetadata(origin: string): JsonValue {
  return protectedResourceMetadata({ resource: `${origin}${MCP_PATH}`, documentation: `${origin}${routes.developers}`, authorizationServer: origin });
}

/** The member a live token names, as an MCP caller whose tools read the circle as them. */
async function callerFor(services: McpServices, token: string, calls: McpCall[]): Promise<McpCaller | null> {
  const resolved = await resolveDelegation(services.db, hashDelegationToken(token));
  if (resolved === null) return null;
  const locale = isLocale(resolved.language) ? resolved.language : defaultLocale;
  const context = { circleId: resolved.circleId, memberId: resolved.memberId, role: resolved.role, delegation: { id: resolved.delegationId, scope: resolved.scope } } as const;
  const now = services.now ?? Date.now;
  return {
    context,
    approveIn: `${services.origin}${localizedPath(locale, dashboardRoutes.approvals)}`,
    onCall: (call) => calls.push(call),
    async openGateway() {
      const circle = await asPerson(services.db, resolved.userId, (tx) => readCircle(tx, { circleId: resolved.circleId, userId: resolved.userId, now: new Date(now()) }));
      const dictionary = await getDictionary(locale);
      const world = askKinWorld({ circle, locale, dictionary, db: services.db, userId: resolved.userId, paypal: services.paypal, executions: () => asPerson(services.db, resolved.userId, (tx) => readExecutions(tx, resolved.circleId)) });
      return toolGateway({ context, implementations: askKinTools(world), recorder: logToolCall, clock: now });
    },
  };
}

const toResponse = (response: McpHttpResponse) => new Response(response.body, { status: response.status, headers: response.headers });

/** Answers one HTTP request to the MCP endpoint, and records every tool call it made under the delegation. */
export async function serveMcp(request: Request, services: McpServices): Promise<Response> {
  const calls: McpCall[] = [];
  let tokenHash: string | null = null;
  const limiter = services.limiter ?? mcpLimiter;
  const now = services.now ?? Date.now;
  const response = await handleMcpHttp(
    { method: request.method, header: (name) => request.headers.get(name), body: () => readCappedText(request, MAX_MCP_BODY_BYTES) },
    {
      allowedOrigins: [services.origin],
      resourceMetadataUrl: `${services.origin}${MCP_METADATA_PATH}`,
      authenticate: async (token) => {
        const hash = hashDelegationToken(token);
        if (!limiter.allows(hash, now())) throw new BusyError();
        limiter.record(hash, now());
        const caller = await callerFor(services, token, calls);
        if (caller !== null) tokenHash = hash;
        return caller;
      },
    },
  ).catch((error: unknown) => {
    if (error instanceof BusyError) return rpcFailure(429, "Too many requests for this delegation. Try again in a minute.", { "retry-after": "60" });
    // The database could not be reached to check the token. Nothing ran; the caller is told to retry, and nothing about the fault.
    console.error(JSON.stringify({ message: "mcp.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return rpcFailure(503, "Kin could not answer just now. Nothing was changed; try again.");
  });
  // Every call that ran is recorded before the answer goes back. If the record cannot be written, the answer is not given either.
  if (tokenHash !== null && calls.length > 0) {
    await recordDelegationCalls(services.db, tokenHash, calls.map((call) => ({ tool: call.requested, outcome: call.outcome, durationMs: call.durationMs, proposalId: call.proposalId, at: call.at })));
  }
  return toResponse(response);
}

const rpcFailure = (status: number, message: string, headers: Readonly<Record<string, string>> = {}): McpHttpResponse => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message } }),
});

class BusyError extends Error {}
