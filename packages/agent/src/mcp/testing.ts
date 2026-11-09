import type { DelegationScope } from "@kin/auth";
import type { CircleRole } from "@kin/domain";
import { vi } from "vitest";

import { ASK_KIN_TOOL_NAMES } from "../ask-kin/ask-kin-tools.ts";
import { toolGateway, type ToolCallRecord, type ToolImplementations, type ToolOutput } from "../ask-kin/tool-gateway.ts";
import { handleMcpHttp, type McpHttpResponse } from "./http.ts";
import type { McpCall, McpCaller } from "./server.ts";

/** Test helpers for the MCP server: a delegation over fake tools, and requests as a client sends them. */

export const TOKEN = `kin_dlg_${"a".repeat(43)}`;
export const ORIGIN = "https://kin.example";
export const METADATA = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;
export const APPROVE_IN = `${ORIGIN}/dashboard/approvals`;

export const found = (data: ToolOutput["data"] = { found: true }, extra: Partial<ToolOutput> = {}): ToolOutput => ({ data, fact: "A fact from the record.", ...extra });

export function fakeTools(overrides: Partial<ToolImplementations> = {}): ToolImplementations {
  const each = vi.fn(async () => found());
  return { ...(Object.fromEntries(ASK_KIN_TOOL_NAMES.map((name) => [name, each])) as unknown as ToolImplementations), ...overrides };
}

export type Harness = { readonly calls: McpCall[]; readonly records: ToolCallRecord[]; readonly send: (message: unknown, headers?: Record<string, string>, method?: string) => Promise<McpHttpResponse & { readonly json: Record<string, unknown> | null }> };

export function harness(options: { readonly role?: CircleRole; readonly scope?: DelegationScope; readonly tools?: ToolImplementations; readonly token?: string } = {}): Harness {
  const calls: McpCall[] = [];
  const records: ToolCallRecord[] = [];
  const context = { circleId: "circle-1", memberId: "marcus", role: options.role ?? "contributor", delegation: { id: "delegation-1", scope: options.scope ?? "propose" } } as const;
  const caller: McpCaller = {
    context,
    openGateway: async () => toolGateway({ context, implementations: options.tools ?? fakeTools(), recorder: (record) => records.push(record), clock: () => 5_000 }),
    approveIn: APPROVE_IN,
    onCall: (call) => calls.push(call),
  };
  const live = options.token ?? TOKEN;
  return {
    calls,
    records,
    async send(message, headers = {}, method = "POST") {
      const all: Record<string, string> = { authorization: `Bearer ${live}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...headers };
      const lower = Object.fromEntries(Object.entries(all).map(([key, value]) => [key.toLowerCase(), value]));
      const response = await handleMcpHttp(
        { method, header: (name) => lower[name] ?? null, body: async () => (typeof message === "string" ? message : JSON.stringify(message)) },
        { allowedOrigins: [ORIGIN], resourceMetadataUrl: METADATA, authenticate: async (token) => (token === TOKEN ? caller : null) },
      );
      return { ...response, json: response.body === null ? null : (JSON.parse(response.body) as Record<string, unknown>) };
    },
  };
}

export const MODERN = "2026-07-28";
export const LEGACY = "2025-11-25";

/** A request of the modern revision, with its `_meta` and the headers that mirror it. */
export function modern(id: number, method: string, params: Record<string, unknown> = {}): [Record<string, unknown>, Record<string, string>] {
  const body = { jsonrpc: "2.0", id, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } };
  const headers: Record<string, string> = { "MCP-Protocol-Version": MODERN, "Mcp-Method": method };
  if (method === "tools/call" && typeof params["name"] === "string") headers["Mcp-Name"] = params["name"];
  return [body, headers];
}

/** A request of a legacy revision, after `initialize`. */
export function legacy(id: number, method: string, params: Record<string, unknown> = {}): [Record<string, unknown>, Record<string, string>] {
  return [{ jsonrpc: "2.0", id, method, params }, { "MCP-Protocol-Version": LEGACY }];
}

/** A tool call's result, as a client reads it. */
export const resultOf = (json: Record<string, unknown> | null) => (json?.["result"] ?? null) as Record<string, unknown> | null;
