import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signAgencyRequest } from "@kin/auth";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { seatAs, startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

const copy = english.openKin;
const PATH = "/dashboard/circle/connections";

/** One JSON-RPC request to Kin's MCP endpoint, as an outside assistant sends it: a bearer token, no browser origin. */
async function mcp(request: APIRequestContext, token: string, id: number, method: string, params: Record<string, unknown> = {}) {
  const response = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
    data: { jsonrpc: "2.0", id, method, params },
  });
  const text = await response.text();
  return { status: response.status(), headers: response.headers(), json: text === "" ? null : (JSON.parse(text) as { result?: Record<string, unknown>; error?: { code: number; data?: { reason?: string } } }) };
}

/** Grants a delegation from the screen and reads the token Kin shows once. */
async function grantFromScreen(page: Page, label: string, scope: "read" | "propose"): Promise<string> {
  await page.getByLabel(copy.grant.label).fill(label);
  await page.getByRole("radio", { name: new RegExp(copy.grant.scopes[scope].title) }).check();
  await page.getByRole("button", { name: copy.grant.submit }).click();
  await expect(page.getByRole("heading", { name: copy.token.title })).toBeVisible();
  const token = await page.getByLabel(copy.token.label).inputValue();
  expect(token).toMatch(/^kin_dlg_[A-Za-z0-9_-]{43}$/u);
  return token;
}

for (const viewport of viewports) {
  test(`connected assistants: the sample, the live console's refused approve, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startDemo(page);
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

    // The demo's sample: Marcus's own assistant read the record, then tried to approve and was refused.
    const sample = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Marcus's Claude" }) });
    await expect(sample).toContainText(copy.list.sample);
    await expect(sample).toContainText(copy.list.outcomes.unknown_tool);
    await expect(sample).toContainText(english.askKin.tools.get_fairness);
    await expect(page.getByText("Sunrise Home Care reports Amara")).toBeVisible();
    await expect(page.getByText(copy.agency.evidence).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The live console plays a real session against the real endpoint, and Kin refuses the approve.
    await page.getByRole("button", { name: copy.console.play }).click();
    const steps = page.getByRole("listitem").filter({ hasText: copy.console.steps.approve.title });
    await expect(steps).toContainText(copy.console.states.refused, { timeout: 20_000 });
    await expect(steps).toContainText("-32602");
    await expect(page.getByText(copy.console.steps.ask.done)).toBeVisible();
    await steps.getByText(copy.console.raw).click();
    await expect(steps.getByText('"reason": "unknown_tool"')).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: copy.console.refreshed })).toBeVisible();
    await maybeScreenshot(page, "connections-console");
    await expectNoHorizontalOverflow(page);

    // Its calls are on the list, under the live console's own short delegation.
    const consoleCard = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: copy.list.console }) });
    await expect(consoleCard).toContainText(copy.list.outcomes.unknown_tool);
    await expect(consoleCard).toContainText(english.askKin.tools.get_fairness);
    await expectNoHorizontalOverflow(page);
  });
}

test("Marcus's own assistant reads what he owes, is refused on approve, and is shut out the call after he revokes it", async ({ page }) => {
  await startDemo(page);
  await seatAs(page, "Marcus");
  await page.goto(PATH);
  const token = await grantFromScreen(page, "Marcus's ChatGPT", "read");
  await expect(page.getByText("claude mcp add --transport http kin")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const init = await mcp(page.request, token, 1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  expect(init.json?.result).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "kin" } });
  const initialized = await page.request.post("/api/mcp", { headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-protocol-version": "2025-11-25" }, data: { jsonrpc: "2.0", method: "notifications/initialized" } });
  expect(initialized.status()).toBe(202);
  const tools = ((await mcp(page.request, token, 3, "tools/list")).json?.result?.["tools"] ?? []) as { name: string }[];
  expect(tools.map((tool) => tool.name)).toContain("get_fairness");
  // A read-only delegation is not offered the one tool that proposes.
  expect(tools.map((tool) => tool.name)).not.toContain("propose_refill");

  const owed = await mcp(page.request, token, 4, "tools/call", { name: "get_fairness", arguments: {} });
  expect(owed.json?.result).toMatchObject({ isError: false, structuredContent: { tool: "get_fairness", record: { simulated: true } } });
  const approve = await mcp(page.request, token, 5, "tools/call", { name: "approve_proposal", arguments: {} });
  expect(approve.json?.error).toMatchObject({ code: -32602, data: { reason: "unknown_tool" } });
  const proposeAnyway = await mcp(page.request, token, 6, "tools/call", { name: "propose_refill", arguments: {} });
  expect(proposeAnyway.json?.result).toMatchObject({ isError: true, structuredContent: { outcome: "refused" } });

  // The calls are on his list; revoking refuses the very next call.
  await page.getByRole("button", { name: copy.token.done }).click();
  await page.reload();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Marcus's ChatGPT" }) });
  await expect(card).toContainText(copy.list.outcomes.unknown_tool);
  await expect(card).toContainText(copy.list.outcomes.refused);
  await card.getByRole("button", { name: "Revoke Marcus's ChatGPT" }).click();
  await expect(card).toContainText(copy.list.revoked);
  const after = await mcp(page.request, token, 7, "tools/list");
  expect(after.status).toBe(401);
  expect(after.headers["www-authenticate"]).toContain("resource_metadata=");
  expect(after.headers["www-authenticate"]).toContain('error="invalid_token"');
});

test("an MCP request with no token is challenged, and a delegation token opens no other route", async ({ page, playwright }) => {
  await startDemo(page);
  await page.goto(PATH);
  const token = await grantFromScreen(page, "Elena's Claude", "propose");
  const outside = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const bare = await outside.post("/api/mcp", { headers: { "content-type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(bare.status()).toBe(401);
    const metadataUrl = /resource_metadata="([^"]+)"/u.exec(bare.headers()["www-authenticate"] ?? "")?.[1] ?? "";
    expect(metadataUrl).toContain("/.well-known/oauth-protected-resource/api/mcp");
    const metadata = await outside.get(new URL(metadataUrl).pathname);
    expect(await metadata.json()).toMatchObject({ bearer_methods_supported: ["header"], scopes_supported: ["kin:read", "kin:propose"] });
    // Only /api/mcp reads a delegation token: the routes that act refuse it.
    for (const route of ["/api/ask-kin", "/api/connections", "/api/settlement"]) {
      const response = await outside.post(route, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, data: { operation: "revoke" } });
      expect({ route, status: response.status() }).not.toEqual({ route, status: 200 });
    }
    expect((await outside.get("/api/mcp", { headers: { authorization: `Bearer ${token}` } })).status()).toBe(405);
    const openapi = await outside.get("/api/v1/openapi.json");
    expect(await openapi.json()).toMatchObject({ openapi: "3.1.0", paths: { "/api/v1/visits": {}, "/api/mcp": {} } });
  } finally {
    await outside.dispose();
  }
});

test("the organizer connects an agency, whose signed visit appears as evidence beside the calendar", async ({ page, playwright }) => {
  await startDemo(page);
  await page.goto(PATH);
  await page.getByLabel(copy.agency.create.label).fill("Harbor Home Health");
  await page.getByRole("button", { name: copy.agency.create.submit }).click();
  await expect(page.getByRole("heading", { name: copy.agency.create.secretTitle })).toBeVisible();
  const keyId = await page.getByLabel(copy.agency.create.keyId).inputValue();
  const secret = await page.getByLabel(copy.agency.create.secret).inputValue();
  await expectNoHorizontalOverflow(page);

  const outside = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const now = new Date();
    const body = JSON.stringify({ externalId: `harbor-${now.getTime()}`, caregiver: "Amara", kind: "aide", startsAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(), endsAt: new Date(now.getTime() - 3_600_000).toISOString() });
    const send = (signature: string) => outside.post("/api/v1/visits", { headers: { "content-type": "application/json", "kin-agency-key": keyId, "kin-signature": signature }, data: body });
    const forged = await send(signAgencyRequest("kin_ags_not-the-secret", Math.floor(now.getTime() / 1000), body));
    expect(forged.status()).toBe(401);
    const sent = await send(signAgencyRequest(secret, Math.floor(now.getTime() / 1000), body));
    expect(sent.status()).toBe(201);
    expect(await sent.json()).toMatchObject({ status: "received", caregiverMatched: true });
  } finally {
    await outside.dispose();
  }
  await page.reload();
  await expect(page.getByText("Harbor Home Health reports Amara")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const viewport of viewports) {
  test(`the developer page fits at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/developers");
    await expect(page.getByRole("heading", { level: 1, name: english.developers.hero.title })).toBeVisible();
    await expect(page.getByText("/api/mcp").first()).toBeVisible();
    await expect(page.getByText("propose_refill").first()).toBeVisible();
    await maybeScreenshot(page, "developers");
    await expectNoHorizontalOverflow(page);
  });
}
