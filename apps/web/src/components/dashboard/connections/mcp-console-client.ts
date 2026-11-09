"use client";

/**
 * The live console's MCP client, in the browser: real JSON-RPC requests to
 * Kin's MCP endpoint, in the stateless 2026-07-28 revision, with every header
 * the transport mirrors. The server decides everything; this only carries
 * the request and keeps what came back, for the screen to show.
 */

export const CONSOLE_PROTOCOL = "2026-07-28";

export type Exchange = {
  readonly request: { readonly headers: Readonly<Record<string, string>>; readonly body: unknown };
  readonly status: number;
  readonly response: unknown;
};

export type RpcReply = { readonly exchange: Exchange; readonly result: Record<string, unknown> | null; readonly error: { readonly code: number; readonly message: string } | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Sends one request. The token is shown on screen only by its last four characters. */
export async function rpc(endpoint: string, token: string, id: number, method: string, params: Record<string, unknown> = {}): Promise<RpcReply> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": CONSOLE_PROTOCOL,
    "mcp-method": method,
  };
  if (method === "tools/call" && typeof params["name"] === "string") headers["mcp-name"] = params["name"];
  const body = {
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": CONSOLE_PROTOCOL, "io.modelcontextprotocol/clientInfo": { name: "kin-live-console", version: "1.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } },
  };
  const response = await fetch(endpoint, { method: "POST", headers: { ...headers, authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    parsed = text;
  }
  const shown = { headers: { ...headers, authorization: `Bearer kin_dlg_…${token.slice(-4)}` }, body };
  const result = isRecord(parsed) && isRecord(parsed["result"]) ? parsed["result"] : null;
  const rawError = isRecord(parsed) && isRecord(parsed["error"]) ? parsed["error"] : null;
  const error = rawError !== null && typeof rawError["code"] === "number" && typeof rawError["message"] === "string" ? { code: rawError["code"], message: rawError["message"] } : null;
  return { exchange: { request: shown, status: response.status, response: parsed }, result, error };
}

/** The live console's own short delegation, which Kin issues only in a demo circle. */
export async function consoleToken(): Promise<{ readonly token: string; readonly endpoint: string } | null> {
  try {
    const response = await fetch("/api/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "console" }) });
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && payload["ok"] === true && typeof payload["token"] === "string" && typeof payload["endpoint"] === "string") return { token: payload["token"], endpoint: payload["endpoint"] };
  } catch {
    // No network, or not JSON: the console says it could not connect.
  }
  return null;
}
