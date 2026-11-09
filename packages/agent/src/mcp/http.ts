import { DELEGATION_OAUTH_SCOPES, bearerToken } from "@kin/auth";

import type { JsonValue } from "../ask-kin/tool-gateway.ts";
import { RPC_ERRORS, readMessage, type RpcError, type RpcId } from "./protocol.ts";
import { answer, eraOf, type McpCaller } from "./server.ts";

/**
 * The Streamable HTTP transport of Kin's MCP server, as plain values in and
 * out so the route in apps/web stays a few lines and this stays testable. In
 * order: the Origin is checked (a browser on another site is refused, against
 * DNS rebinding), only POST is served, the delegation token is verified, and
 * then one JSON-RPC message is read and answered with a single JSON object.
 * A notification is accepted with 202 and nothing else.
 */

/** The largest request body read: a tool call's arguments are a few hundred bytes. */
export const MAX_MCP_BODY_BYTES = 32_768;

export type McpHttpRequest = {
  readonly method: string;
  /** A header's value by its lowercase name, or `null`. */
  readonly header: (name: string) => string | null;
  /** The body as text, or `null` when it was larger than MAX_MCP_BODY_BYTES. */
  readonly body: () => Promise<string | null>;
};

export type McpHttpResponse = { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string | null };

export type McpHttpOptions = {
  /** The origins a browser may call from: Kin's own pages, for the live console. */
  readonly allowedOrigins: readonly string[];
  /** The protected resource metadata document's address, for the 401 challenge. */
  readonly resourceMetadataUrl: string;
  /** The assistant a verified, live delegation token names, or `null` for any other token. */
  readonly authenticate: (token: string) => Promise<McpCaller | null>;
};

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;

const rpcError = (status: number, id: RpcId | null, error: RpcError, headers: Readonly<Record<string, string>> = {}): McpHttpResponse => ({
  status,
  headers: { ...JSON_HEADERS, ...headers },
  body: JSON.stringify(id === null ? { jsonrpc: "2.0", error } : { jsonrpc: "2.0", id, error }),
});

/** The RFC 6750 challenge a client follows to the metadata document: which scope to ask for, and why the token failed. */
export function bearerChallenge(resourceMetadataUrl: string, error?: "invalid_token"): string {
  const parts = [`resource_metadata="${resourceMetadataUrl}"`, `scope="${DELEGATION_OAUTH_SCOPES.read}"`];
  if (error) parts.push(`error="${error}"`, `error_description="The delegation token is unknown, expired or revoked. Ask the member for a new one in Kin."`);
  return `Bearer ${parts.join(", ")}`;
}

function unauthorized(options: McpHttpOptions, error?: "invalid_token"): McpHttpResponse {
  return rpcError(401, null, { code: RPC_ERRORS.invalidRequest, message: error ? "Unauthorized: the delegation token is not live." : "Unauthorized: send a delegation token as a bearer token." }, { "www-authenticate": bearerChallenge(options.resourceMetadataUrl, error) });
}

function acceptsJson(accept: string | null): boolean {
  if (accept === null) return true;
  return /application\/json|text\/event-stream|\*\/\*|application\/\*/iu.test(accept);
}

export async function handleMcpHttp(request: McpHttpRequest, options: McpHttpOptions): Promise<McpHttpResponse> {
  const origin = request.header("origin");
  if (origin !== null && !options.allowedOrigins.includes(origin)) return rpcError(403, null, { code: RPC_ERRORS.invalidRequest, message: "Forbidden: this origin may not call Kin's MCP server." });
  if (request.method !== "POST") return { status: 405, headers: { allow: "POST", "cache-control": "no-store" }, body: null };

  const authorization = request.header("authorization");
  if (authorization === null) return unauthorized(options);
  const token = bearerToken(authorization);
  const caller = token === null ? null : await options.authenticate(token);
  if (caller === null) return unauthorized(options, "invalid_token");

  if (!acceptsJson(request.header("accept"))) return rpcError(406, null, { code: RPC_ERRORS.invalidRequest, message: "Not acceptable: Kin answers with application/json." });
  if (!/^application\/json\b/iu.test(request.header("content-type") ?? "")) return rpcError(415, null, { code: RPC_ERRORS.invalidRequest, message: "Unsupported media type: send application/json." });
  const body = await request.body();
  if (body === null) return rpcError(413, null, { code: RPC_ERRORS.invalidRequest, message: "Request too large." });

  const message = readMessage(body);
  if ("code" in message) return rpcError(400, null, message);
  if (message.kind === "notification") return { status: 202, headers: { "cache-control": "no-store" }, body: null };
  if (message.kind === "response") return rpcError(400, null, { code: RPC_ERRORS.invalidRequest, message: "Invalid request: Kin sends no requests, so it expects no responses." });

  const era = eraOf(message, request.header);
  if ("error" in era) return rpcError(era.status, message.id, era.error);
  let answered;
  try {
    answered = await answer(message, era, caller);
  } catch {
    // Nothing about the fault reaches the caller: it is the server's to look into.
    return rpcError(500, message.id, { code: RPC_ERRORS.internal, message: "Internal error. Nothing was changed." });
  }
  if ("error" in answered) {
    // A legacy client reads a JSON-RPC error from any 200; the modern revision gives each its status.
    return rpcError(era.kind === "modern" ? answered.status : 200, message.id, answered.error);
  }
  const reply: JsonValue = { jsonrpc: "2.0", id: message.id, result: answered.result };
  return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(reply) };
}

/**
 * The OAuth 2.0 Protected Resource Metadata document (RFC 9728) for the MCP
 * endpoint. It names no authorization server: Kin issues delegation tokens
 * from its own screen, to a member who is signed in, so a client is
 * configured with the token as a bearer header. The scopes are the
 * delegation's.
 */
export function protectedResourceMetadata(input: { readonly resource: string; readonly documentation: string }): JsonValue {
  return {
    resource: input.resource,
    resource_name: "Kin",
    bearer_methods_supported: ["header"],
    scopes_supported: [DELEGATION_OAUTH_SCOPES.read, DELEGATION_OAUTH_SCOPES.propose],
    resource_documentation: input.documentation,
  };
}
