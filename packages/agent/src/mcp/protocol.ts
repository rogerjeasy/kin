/**
 * The parts of the Model Context Protocol Kin's server speaks, checked against
 * the specification at modelcontextprotocol.io on 9 November 2026: revision
 * 2026-07-28 (stateless, every request carries its version in `_meta` and in
 * the `MCP-Protocol-Version` header, `server/discover` instead of a
 * handshake), and the initialize-handshake revisions before it, so clients of
 * either era can connect ("dual-era" in the specification's words). Kin never
 * mints a session: each request stands alone.
 */

/** The revisions that carry their version per request. */
export const MODERN_VERSIONS = ["2026-07-28"] as const;
/** The revisions that open with `initialize`, newest first. */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
/** A legacy request without the header is read as this revision, as the transport allows. */
export const HEADERLESS_VERSION = "2025-03-26";

export const isModernVersion = (version: string): boolean => (MODERN_VERSIONS as readonly string[]).includes(version);
export const isLegacyVersion = (version: string): boolean => (LEGACY_VERSIONS as readonly string[]).includes(version);

/** JSON-RPC's codes and the three MCP defines. */
export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

export const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

export const HEADERS = { protocolVersion: "mcp-protocol-version", method: "mcp-method", name: "mcp-name" } as const;

export type RpcId = string | number;

export type RpcError = { readonly code: number; readonly message: string; readonly data?: unknown };

/** One JSON-RPC message from a client, as far as its shape goes. */
export type RpcMessage =
  | { readonly kind: "request"; readonly id: RpcId; readonly method: string; readonly params: Readonly<Record<string, unknown>> }
  | { readonly kind: "notification"; readonly method: string }
  | { readonly kind: "response" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The message a body holds, or the JSON-RPC error that refuses it. A batch is
 * refused: no revision Kin speaks after 2025-03-26 allows one, and none is
 * needed. An ID of `null` is refused, as MCP requires.
 */
export function readMessage(body: string): RpcMessage | RpcError {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    return { code: RPC_ERRORS.parse, message: "Parse error: the body is not JSON." };
  }
  if (!isRecord(value) || value["jsonrpc"] !== "2.0") return { code: RPC_ERRORS.invalidRequest, message: "Invalid request: send one JSON-RPC 2.0 object per request." };
  const { id, method, params } = value;
  if (method === undefined && ("result" in value || "error" in value)) return { kind: "response" };
  if (typeof method !== "string" || method === "" || method.length > 128) return { code: RPC_ERRORS.invalidRequest, message: "Invalid request: no method." };
  if (params !== undefined && !isRecord(params)) return { code: RPC_ERRORS.invalidRequest, message: "Invalid request: params must be an object." };
  if (!("id" in value)) return { kind: "notification", method };
  if (!((typeof id === "string" && id.length <= 200) || (typeof id === "number" && Number.isSafeInteger(id)))) return { code: RPC_ERRORS.invalidRequest, message: "Invalid request: the id must be a string or an integer." };
  return { kind: "request", id, method, params: params ?? {} };
}

/** The `_meta` object of a request's params, if it has one. */
export function metaOf(params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | null {
  const meta = params["_meta"];
  return isRecord(meta) ? meta : null;
}

/**
 * A mirrored header's value, decoded: plain visible ASCII as it is, or the
 * `=?base64?…?=` sentinel decoded from UTF-8. `undefined` when it cannot be
 * read, which the caller refuses as a mismatch.
 */
export function decodeHeader(value: string): string | undefined {
  const sentinel = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/u.exec(value);
  if (sentinel) {
    const decoded = Buffer.from(sentinel[1] ?? "", "base64").toString("utf8");
    return decoded.includes("�") ? undefined : decoded;
  }
  return /^[\x20-\x7E\t]*$/u.test(value) ? value : undefined;
}
