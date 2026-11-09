import { agencySecret, hashAgencySecret, newAgencyKeyId, signAgencyRequest } from "@kin/auth";
import { asPerson, createAgencyKey, readCircle, type CircleSnapshot } from "@kin/db";
import { realCircle, seatPerson, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../model";
import { receiveVisit } from "./agency";
import { connectionsScreen, manageConnection } from "./connections";
import { serveMcp } from "./mcp";
import { openApiDocument } from "./openapi";
import { testDatabases } from "../../../../../packages/db/src/testing/databases.ts";

const db = testDatabases();
const ORIGIN = "https://kin.test";
const SIGNING_KEY = "a signing key for agency secrets in this test, long enough";

const snapshot = (circle: { circleId: string }, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date() }));
const connections = async (circle: { circleId: string }, userId: string) => ({ db: db.app, userId, circle: await snapshot(circle, userId), origin: ORIGIN });

async function tokenFor(circle: { circleId: string }, userId: string, input: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const result = await manageConnection(await connections(circle, userId), input);
  if (!result.ok || !("token" in result)) throw new Error(`No token: ${JSON.stringify(result)}`);
  return { id: result.id, token: result.token };
}

let next = 1;
async function mcp(token: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: next++, method, params });
  const request = new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...headers }, body });
  const response = await serveMcp(request, { db: db.app, origin: ORIGIN, paypal: null, limiter: createRateLimiter(1_000, 60_000) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text === "" ? null : (JSON.parse(text) as Record<string, unknown>) };
}
const result = (reply: { json: Record<string, unknown> | null }) => reply.json?.["result"] as Record<string, unknown> | undefined;

describe("a member's own assistant through Kin's MCP server", () => {
  it("answers 'what do I owe this month?' from the verified record, is refused on approve, and every call is on the member's list", async () => {
    const circle = await visitorWithCircle(db);
    const { id, token } = await tokenFor(circle, circle.userId, { operation: "console" });
    const init = await mcp(token, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(result(init)).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "kin" } });
    const listed = await mcp(token, "tools/list");
    expect((result(listed)?.["tools"] as { name: string }[]).map((tool) => tool.name)).toContain("get_fairness");

    const owed = await mcp(token, "tools/call", { name: "get_fairness", arguments: {} });
    expect(result(owed)).toMatchObject({ isError: false, structuredContent: { tool: "get_fairness", record: { calculatedBy: "Kin's money core, from the ledger and the agreement", simulated: true } } });
    expect(JSON.stringify(result(owed)?.["structuredContent"])).toContain("Marcus");

    const approve = await mcp(token, "tools/call", { name: "approve_proposal", arguments: { proposalId: id } });
    expect(approve.status).toBe(200);
    expect(approve.json?.["error"]).toMatchObject({ code: -32602, data: { reason: "unknown_tool" } });

    const screen = await connectionsScreen(await connections(circle, circle.userId));
    const consoleDelegation = screen.delegations.find((each) => each.id === id);
    expect(consoleDelegation).toMatchObject({ console: true, scope: "propose" });
    expect(consoleDelegation?.calls.map((call) => [call.tool, call.outcome])).toEqual([
      ["approve_proposal", "unknown_tool"],
      ["get_fairness", "ok"],
    ]);
  });

  it("refuses a proposing tool under a read scope, and raises a proposal that waits for the family under a propose scope", async () => {
    const circle = await visitorWithCircle(db);
    const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
    const reader = await tokenFor(circle, marcus, { operation: "grant", label: "Marcus's ChatGPT", scope: "read", days: 7 });
    const refused = await mcp(reader.token, "tools/call", { name: "propose_refill", arguments: {} });
    expect(result(refused)).toMatchObject({ isError: true, structuredContent: { outcome: "refused" } });

    const proposer = await tokenFor(circle, marcus, { operation: "grant", label: "Marcus's Claude", scope: "propose", days: 1 });
    // The demo's standing permission would cover a refill; ended here, the refill must wait for the family's yes.
    await db.admin.execute(`update mandates set status = 'revoked', ended_at = now() where circle_id = '${circle.circleId}'`);
    const proposed = await mcp(proposer.token, "tools/call", { name: "propose_refill", arguments: {} });
    const proposal = (result(proposed)?.["structuredContent"] as { proposal?: { id: string; approveIn: string } } | undefined)?.proposal;
    expect(proposal).toMatchObject({ status: "waiting_for_the_family", approveIn: `${ORIGIN}/dashboard/approvals` });
    const after = await snapshot(circle, marcus);
    expect(after.proposals.find((each) => each.id === proposal?.id)?.state).toBe("pending_approval");
  });

  it("refuses the next call with 401 once the member revokes, and a browser on another site with 403", async () => {
    const circle = await visitorWithCircle(db);
    const { id, token } = await tokenFor(circle, circle.userId, { operation: "grant", label: "Elena's Claude", scope: "read", days: 30 });
    expect((await mcp(token, "ping")).status).toBe(200);
    expect((await mcp(token, "ping", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect(await manageConnection(await connections(circle, circle.userId), { operation: "revoke", id })).toEqual({ ok: true, revoked: true });
    const after = await mcp(token, "ping");
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("issues the live console only in a demo circle, and grants nothing to an observer", async () => {
    const real = await realCircle(db);
    expect(await manageConnection(await connections(real, real.userId), { operation: "console" })).toEqual({ ok: false, reason: "demo_only" });
    const circle = await visitorWithCircle(db);
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    expect(await manageConnection(await connections(circle, daniel), { operation: "grant", label: "Daniel's", scope: "read", days: 7 })).toEqual({ ok: false, reason: "refused" });
  });

  it("refuses a grant that is not one of the screen's", async () => {
    const circle = await visitorWithCircle(db);
    const context = await connections(circle, circle.userId);
    for (const input of [{ operation: "grant", label: "x", scope: "approve", days: 7 }, { operation: "grant", label: "x", scope: "read", days: 365 }, { operation: "grant", label: "<b>", scope: "read", days: 7 }, { operation: "grant", label: "x", scope: "read", days: 7, role: "organizer" }, { operation: "approve" }]) {
      expect(await manageConnection(context, input)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("an agency's software reporting a visit", () => {
  async function agencyKey(circle: VisitorCircle) {
    const keyId = newAgencyKeyId();
    const secret = agencySecret(SIGNING_KEY, keyId);
    await asPerson(db.app, circle.userId, (tx) => createAgencyKey(tx, { circleId: circle.circleId, label: "Sunrise Home Care", keyId, secretHash: hashAgencySecret(secret) }));
    return { keyId, secret };
  }
  const NOW = new Date("2026-11-09T12:00:00Z");
  const post = (key: { keyId: string; secret: string }, body: string, change: { signature?: string; at?: number; signingKey?: string | null } = {}) =>
    receiveVisit(
      new Request(`${ORIGIN}/api/v1/visits`, { method: "POST", headers: { "content-type": "application/json", "kin-agency-key": key.keyId, "kin-signature": change.signature ?? signAgencyRequest(key.secret, change.at ?? NOW.getTime() / 1000, body) }, body }),
      { db: db.app, signingKey: change.signingKey === undefined ? SIGNING_KEY : change.signingKey, now: () => NOW },
    );
  const visit = JSON.stringify({ externalId: "sunrise-1", caregiver: "Amara", kind: "aide", startsAt: "2026-11-09T09:00:00-05:00", endsAt: "2026-11-09T13:00:00-05:00", checkedInAt: "2026-11-09T09:02:00-05:00", checkedOutAt: "2026-11-09T13:00:00-05:00" });

  it("keeps a signed visit as evidence, says it pays nothing, and is idempotent", async () => {
    const circle = await visitorWithCircle(db);
    const key = await agencyKey(circle);
    const first = await post(key, visit);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: "received", duplicate: false, caregiverMatched: true, note: expect.stringContaining("nothing is paid") });
    expect((await post(key, visit)).status).toBe(200);
    expect((await post(key, visit.replace("13:00:00-05:00\"}", "14:00:00-05:00\"}"))).status).toBe(409);
  });

  it("refuses a wrong signature, a stale one, an unknown key, and keeps an unreadable body as refused", async () => {
    const circle = await visitorWithCircle(db);
    const key = await agencyKey(circle);
    expect((await post(key, visit, { signature: signAgencyRequest(agencySecret(SIGNING_KEY, newAgencyKeyId()), NOW.getTime() / 1000, visit) })).status).toBe(401);
    expect((await post(key, visit, { at: NOW.getTime() / 1000 - 3_600 })).status).toBe(401);
    expect((await post({ keyId: newAgencyKeyId(), secret: key.secret }, visit)).status).toBe(401);
    const unreadable = JSON.stringify({ externalId: "x", approve: true });
    const refused = await post(key, unreadable);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ status: "refused", reason: "shape" });
    expect((await post(key, visit, { signingKey: null })).status).toBe(503);
  });
});

describe("the OpenAPI document", () => {
  it("publishes the visit schema the API checks and every MCP tool's input schema, and lists no tool that approves", () => {
    const document = openApiDocument(ORIGIN) as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, { additionalProperties?: boolean }> }; "x-kin-mcp-tools": Record<string, { kind: string }> };
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toEqual(["/api/v1/visits", "/api/mcp", "/.well-known/oauth-protected-resource/api/mcp"]);
    expect(document.components.schemas["VisitReport"]?.additionalProperties).toBe(false);
    for (const [name, tool] of Object.entries(document["x-kin-mcp-tools"])) {
      expect(["read", "propose"]).toContain(tool.kind);
      expect(name).not.toMatch(/approve|pay_|execute/u);
    }
  });
});
