import { DELEGATION_SCOPES } from "@kin/auth";
import { CIRCLE_ROLES } from "@kin/domain";
import { describe, expect, it, vi } from "vitest";

import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES } from "../ask-kin/ask-kin-tools.ts";
import { protectedResourceMetadata } from "./http.ts";
import { MODERN_VERSIONS, SUPPORTED_VERSIONS } from "./protocol.ts";
import { APPROVE_IN, LEGACY, METADATA, MODERN, ORIGIN, fakeTools, found, harness, legacy, modern, resultOf } from "./testing.ts";

const toolNames = (json: Record<string, unknown> | null) => ((resultOf(json)?.["tools"] ?? []) as { name: string }[]).map((tool) => tool.name);

describe("Kin's MCP server over Streamable HTTP", () => {
  it("challenges a request with no token, pointing at the resource metadata", async () => {
    const response = await harness().send(legacy(1, "tools/list")[0], { authorization: "" });
    // An empty header is no token at all.
    expect(response.status).toBe(401);
    const bare = await harness().send({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: "Bearer" });
    expect(bare.status).toBe(401);
    expect(bare.headers["www-authenticate"]).toContain(`resource_metadata="${METADATA}"`);
    expect(bare.headers["www-authenticate"]).toContain('error="invalid_token"');
  });

  it("refuses an unknown or revoked token with 401 and invalid_token", async () => {
    const response = await harness({ token: `kin_dlg_${"b".repeat(43)}` }).send(legacy(1, "tools/list")[0], legacy(1, "tools/list")[1]);
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toMatch(/^Bearer resource_metadata=".+", scope="kin:read", error="invalid_token"/u);
  });

  it("refuses a browser on another site with 403, and serves Kin's own pages", async () => {
    const [body, headers] = legacy(1, "ping");
    expect((await harness().send(body, { ...headers, origin: "https://evil.example" })).status).toBe(403);
    expect((await harness().send(body, { ...headers, origin: ORIGIN })).status).toBe(200);
  });

  it("serves POST only, and opens no stream or session", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await harness().send("", {}, method);
      expect(response.status).toBe(405);
      expect(response.headers["allow"]).toBe("POST");
    }
  });

  it("answers the legacy handshake, accepts initialized with 202, and never mints a session", async () => {
    const mcp = harness();
    const init = await mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } });
    expect(init.status).toBe(200);
    expect(resultOf(init.json)).toMatchObject({ protocolVersion: LEGACY, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "kin" } });
    expect(String(resultOf(init.json)?.["instructions"])).toContain("cannot approve");
    expect(init.headers["mcp-session-id"]).toBeUndefined();
    const initialized = await mcp.send({ jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": LEGACY });
    expect(initialized.status).toBe(202);
    expect(initialized.body).toBeNull();
  });

  it("offers its newest legacy revision to a client that asks for one it does not know", async () => {
    const init = await harness().send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-01-01", capabilities: {} } });
    expect(resultOf(init.json)?.["protocolVersion"]).toBe(LEGACY);
  });

  it("discovers, lists and calls statelessly in the modern revision, with every header mirrored", async () => {
    const mcp = harness();
    const discovered = await mcp.send(...modern(1, "server/discover"));
    expect(resultOf(discovered.json)).toMatchObject({ resultType: "complete", supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } } });
    expect(resultOf(discovered.json)?.["_meta"]).toEqual({ "io.modelcontextprotocol/serverInfo": { name: "kin", title: "Kin", version: "1.0.0" } });
    const listed = await mcp.send(...modern(2, "tools/list"));
    expect(toolNames(listed.json)).toEqual(ASK_KIN_TOOL_NAMES);
    const called = await mcp.send(...modern(3, "tools/call", { name: "get_fairness", arguments: {} }));
    expect(called.status).toBe(200);
    expect(resultOf(called.json)).toMatchObject({ resultType: "complete", isError: false });
    expect(MODERN_VERSIONS).toContain(MODERN);
  });

  it("refuses a modern request whose headers do not match its body", async () => {
    const mcp = harness();
    const [body, headers] = modern(1, "tools/call", { name: "get_pool", arguments: {} });
    const changes: Record<string, string>[] = [{ "Mcp-Name": "get_fairness" }, { "Mcp-Method": "tools/list" }, { "MCP-Protocol-Version": LEGACY }];
    for (const changed of changes) {
      const response = await mcp.send(body, { ...headers, ...changed });
      expect(response.status).toBe(400);
      expect(response.json?.["error"]).toMatchObject({ code: -32020 });
    }
    const withoutName = { ...headers };
    delete withoutName["Mcp-Name"];
    expect((await mcp.send(body, withoutName)).json?.["error"]).toMatchObject({ code: -32020 });
    // The sentinel encoding of the name is read before it is compared.
    const encoded = await mcp.send(body, { ...headers, "Mcp-Name": `=?base64?${Buffer.from("get_pool").toString("base64")}?=` });
    expect(encoded.status).toBe(200);
  });

  it("refuses a modern request without its client capabilities, and a version it does not speak", async () => {
    const mcp = harness();
    const [body, headers] = modern(1, "tools/list");
    const meta = { ...(body["params"] as { _meta: Record<string, unknown> })._meta };
    delete meta["io.modelcontextprotocol/clientCapabilities"];
    const missing = await mcp.send({ ...body, params: { _meta: meta } }, headers);
    expect(missing.status).toBe(400);
    expect(missing.json?.["error"]).toMatchObject({ code: -32602 });

    const unknown = await mcp.send({ ...body, params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } }, { ...headers, "MCP-Protocol-Version": "1900-01-01" });
    expect(unknown.status).toBe(400);
    expect(unknown.json?.["error"]).toMatchObject({ code: -32022, data: { supported: SUPPORTED_VERSIONS, requested: "1900-01-01" } });
    const headerOnly = await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "MCP-Protocol-Version": MODERN });
    expect(headerOnly.status).toBe(400);
  });

  it("answers an unknown method with -32601: 404 in the modern revision, in a 200 for a legacy client", async () => {
    const mcp = harness();
    const modernReply = await mcp.send(...modern(1, "resources/list"));
    expect(modernReply.status).toBe(404);
    expect(modernReply.json?.["error"]).toMatchObject({ code: -32601 });
    const legacyReply = await mcp.send(...legacy(2, "prompts/list"));
    expect(legacyReply.status).toBe(200);
    expect(legacyReply.json?.["error"]).toMatchObject({ code: -32601 });
  });

  it("refuses what is not one JSON-RPC request", async () => {
    const mcp = harness();
    expect((await mcp.send("{not json")).json?.["error"]).toMatchObject({ code: -32700 });
    expect((await mcp.send([{ jsonrpc: "2.0", id: 1, method: "ping" }])).json?.["error"]).toMatchObject({ code: -32600 });
    expect((await mcp.send({ jsonrpc: "1.0", id: 1, method: "ping" })).json?.["error"]).toMatchObject({ code: -32600 });
    expect((await mcp.send({ jsonrpc: "2.0", id: null, method: "ping" })).json?.["error"]).toMatchObject({ code: -32600 });
    expect((await mcp.send({ jsonrpc: "2.0", id: 1, result: {} })).status).toBe(400);
    expect((await mcp.send({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await mcp.send({ jsonrpc: "2.0", id: 1, method: "ping" }, { accept: "text/html" })).status).toBe(406);
  });

  it("answers ping in either revision", async () => {
    const mcp = harness();
    expect(resultOf((await mcp.send(...legacy(1, "ping"))).json)).toEqual({});
    expect(resultOf((await mcp.send(...modern(2, "ping"))).json)).toMatchObject({ resultType: "complete" });
  });

  it("publishes protected resource metadata that names the delegation's scopes", () => {
    expect(protectedResourceMetadata({ resource: `${ORIGIN}/api/mcp`, documentation: `${ORIGIN}/developers` })).toEqual({
      resource: `${ORIGIN}/api/mcp`,
      resource_name: "Kin",
      bearer_methods_supported: ["header"],
      scopes_supported: ["kin:read", "kin:propose"],
      resource_documentation: `${ORIGIN}/developers`,
    });
  });
});

describe("the tools an assistant is offered and what they may do", () => {
  it("are the gateway's tools for the member's role, narrowed by the delegation's scope", async () => {
    for (const role of CIRCLE_ROLES) {
      for (const scope of DELEGATION_SCOPES) {
        const listed = toolNames((await harness({ role, scope }).send(...legacy(1, "tools/list"))).json);
        for (const name of listed) expect({ role, scope, name, proposes: ASK_KIN_TOOLS[name as keyof typeof ASK_KIN_TOOLS].kind === "propose" }).toEqual({ role, scope, name, proposes: scope === "propose" && ASK_KIN_TOOLS[name as keyof typeof ASK_KIN_TOOLS].kind === "propose" });
      }
    }
    expect(toolNames((await harness({ role: "observer", scope: "propose" }).send(...legacy(1, "tools/list"))).json)).not.toContain("propose_refill");
    expect(toolNames((await harness({ role: "caregiver", scope: "read" }).send(...legacy(1, "tools/list"))).json)).toEqual(["list_bills", "list_proposals", "get_paypal_payout_status"]);
  });

  it("include none that approves, pays, executes or edits: every tool only reads or only proposes", () => {
    for (const name of ASK_KIN_TOOL_NAMES) {
      expect(["read", "propose"]).toContain(ASK_KIN_TOOLS[name].kind);
      expect(name).not.toMatch(/approve|answer|execute|pay_|payout_create|capture|send|sign|grant|delete|edit|update|refund|transfer/u);
    }
  });

  it("mark the reading tools read-only and the proposing one not, for the client's own prompts", async () => {
    const tools = (resultOf((await harness().send(...legacy(1, "tools/list"))).json)?.["tools"] ?? []) as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; description: string }[];
    for (const tool of tools) {
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.readOnlyHint).toBe(tool.name !== "propose_refill");
    }
    expect(tools.find((tool) => tool.name === "propose_refill")?.description).toContain("returns only the proposal's ID");
  });

  it("refuses a tool the scope does not allow, runs nothing, and records the refusal", async () => {
    const proposeRefill = vi.fn(async () => found({ proposed: true }, { proposal: { id: "proposal-1" } }));
    const mcp = harness({ scope: "read", tools: fakeTools({ propose_refill: proposeRefill }) });
    const reply = await mcp.send(...legacy(1, "tools/call", { name: "propose_refill", arguments: {} }));
    expect(resultOf(reply.json)).toMatchObject({ isError: true, structuredContent: { outcome: "refused" } });
    expect(proposeRefill).not.toHaveBeenCalled();
    expect(mcp.calls).toEqual([expect.objectContaining({ requested: "propose_refill", outcome: "refused", proposalId: null })]);
    expect(mcp.records).toEqual([expect.objectContaining({ tool: "propose_refill", outcome: "refused" })]);
  });

  it("return only the proposal and where a person approves it, when a tool proposes", async () => {
    const mcp = harness({ tools: fakeTools({ propose_refill: async () => found({ proposed: true, item: "Lisinopril" }, { proposal: { id: "proposal-1" } }) }) });
    const reply = await mcp.send(...legacy(1, "tools/call", { name: "propose_refill", arguments: {} }));
    expect(resultOf(reply.json)).toMatchObject({ isError: false, structuredContent: { proposal: { id: "proposal-1", status: "waiting_for_the_family", approveIn: APPROVE_IN } } });
    expect(mcp.calls).toEqual([expect.objectContaining({ requested: "propose_refill", outcome: "ok", proposalId: "proposal-1" })]);
  });

  it.each([
    "approve_proposal",
    "approve",
    "answer_proposal",
    "execute_payout",
    "pay_bill",
    "pay_my_share",
    "settle_month",
    "sign_care_agreement",
    "grant_mandate",
    // The PayPal Agent Toolkit's writes: they stay behind Kin.
    "create_order",
    "capture_order",
    "create_payout",
    "create_invoice",
    "send_invoice",
    "create_refund",
    "cancel_subscription",
    "update_shipment_tracking",
    "paypal.create_payout",
  ])("refuses %s as an unknown tool through MCP, and runs nothing", async (name) => {
    const tools = fakeTools();
    const mcp = harness({ role: "organizer", tools });
    const reply = await mcp.send(...modern(1, "tools/call", { name, arguments: { proposalId: "proposal-1", decision: "approve" } }));
    expect(reply.status).toBe(400);
    expect(reply.json?.["error"]).toMatchObject({ code: -32602, message: `Unknown tool: ${name}`, data: { reason: "unknown_tool" } });
    expect(vi.mocked(tools.get_pool)).not.toHaveBeenCalled();
    expect(mcp.calls).toEqual([expect.objectContaining({ requested: name, outcome: "unknown_tool" })]);
  });
});
