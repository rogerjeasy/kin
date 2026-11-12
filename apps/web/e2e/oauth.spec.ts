import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import english from "../src/i18n/dictionaries/en.json" with { type: "json" };
import { fill } from "../src/i18n/template";
import { startDemo } from "./support/demo";
import { expectNoHorizontalOverflow } from "./support/expect-no-horizontal-overflow";
import { REDIRECT_URI, RESOURCE, asOwner, authorizeUrl, catchRedirect, mcpCall, ownSeat, pkce, registerClient, sha256, trade, type Pkce } from "./support/oauth-client";
import { E2E_APP_ORIGIN } from "./support/ports";
import { maybeScreenshot } from "./support/screenshot";
import { viewports } from "./support/viewports";

/**
 * OAuth 2.1 with PKCE for Kin's MCP server (decision 112), end to end: an
 * outside client registers, sends the signed-in organizer to Kin's consent
 * screen, trades the code for a delegation token and lists its tools; and
 * every way to cheat that flow is refused. Runs after the real-circle tests,
 * in the person's own circle (playwright.config.ts).
 */

const copy = english.openKin.oauth;
const scopes = english.openKin.grant.scopes;
const CLIENT_NAME = "E2E assistant";

test.describe.configure({ mode: "serial" });

// Registering is rate-limited per address, so the tests share one client, registered on first use.
let registered: string | null = null;
async function sharedClient(request: APIRequestContext): Promise<string> {
  registered ??= await registerClient(request, CLIENT_NAME);
  return registered;
}

/** Opens the authorization request in the signed-in browser and answers yes; returns the code the client receives. */
async function consentYes(page: Page, clientId: string, pair: Pkce, choose: { scope?: "read" | "propose"; days?: string } = {}) {
  const answer = await catchRedirect(page);
  await page.goto(authorizeUrl(clientId, pair));
  await expect(page.getByRole("heading", { level: 1, name: fill(copy.title, { client: CLIENT_NAME }) })).toBeVisible();
  if (choose.scope) await page.getByRole("radio", { name: new RegExp(scopes[choose.scope].title) }).check();
  if (choose.days) await page.getByLabel(english.openKin.grant.lifetime).selectOption(choose.days);
  await page.getByRole("button", { name: copy.allow, exact: true }).click();
  await expect.poll(() => answer()?.code ?? null).not.toBeNull();
  const received = answer();
  if (received?.code == null) throw new Error("No code reached the client");
  return { ...received, code: received.code };
}

const form = (clientId: string, code: string, pair: Pkce, change: Record<string, string> = {}) => ({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT_URI, code_verifier: pair.verifier, resource: RESOURCE, ...change });

test("an MCP client discovers Kin as its own authorization server from the 401", async ({ request }) => {
  const challenge = await request.post("/api/mcp", { headers: { "content-type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "ping" } });
  expect(challenge.status()).toBe(401);
  const metadataUrl = /resource_metadata="([^"]+)"/u.exec(challenge.headers()["www-authenticate"] ?? "")?.[1];
  expect(metadataUrl).toBe(`${E2E_APP_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`);
  const resource = (await (await request.get(metadataUrl ?? "")).json()) as { resource: string; authorization_servers: string[] };
  expect(resource).toMatchObject({ resource: RESOURCE, authorization_servers: [E2E_APP_ORIGIN] });
  const server = await request.get("/.well-known/oauth-authorization-server");
  expect(server.headers()["access-control-allow-origin"]).toBe("*");
  expect(await server.json()).toMatchObject({
    issuer: E2E_APP_ORIGIN,
    authorization_endpoint: `${E2E_APP_ORIGIN}/api/oauth/authorize`,
    token_endpoint: `${E2E_APP_ORIGIN}/api/oauth/token`,
    registration_endpoint: `${E2E_APP_ORIGIN}/api/oauth/register`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: ["kin:read", "kin:propose"],
  });
  const refused = await request.post("/api/oauth/register", { data: { client_name: "Evil", redirect_uris: ["http://evil.example/cb"] } });
  expect(refused.status()).toBe(400);
  expect(await refused.json()).toMatchObject({ error: "invalid_redirect_uri" });
});

for (const viewport of viewports) {
  test(`the consent screen names the client, where the code goes and the seat, at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const clientId = await sharedClient(page.request);
    await page.goto(authorizeUrl(clientId, pkce()));
    await expect(page).toHaveURL(/\/dashboard\/circle\/connections\/authorize\?/u);
    await expect(page.getByRole("heading", { level: 1, name: fill(copy.title, { client: CLIENT_NAME }) })).toBeVisible();
    const who = page.getByRole("region", { name: copy.who });
    await expect(who).toContainText("127.0.0.1:45555");
    await expect(who).toContainText(copy.localWarning);
    await expect(who).toContainText("Mum’s circle");
    await expect(who).toContainText(english.dashboard.common.roles.organizer);
    await expect(page.getByRole("radio", { name: new RegExp(scopes.read.title) })).toBeChecked();
    await expect(page.getByRole("button", { name: copy.allow, exact: true })).toBeVisible();
    await expect(page.getByText(copy.never)).toBeVisible();
    await maybeScreenshot(page, `oauth-consent-${viewport.width}`);
    await expectNoHorizontalOverflow(page);
  });
}

test("the organizer says yes; the client trades the code with its verifier, lists the tools, and is still refused an approve", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const pair = pkce();
  const answer = await consentYes(page, clientId, pair, { scope: "propose", days: "7" });
  expect(answer).toMatchObject({ state: "e2e-state", iss: E2E_APP_ORIGIN, error: null });
  expect(answer.code).toMatch(/^kin_code_[A-Za-z0-9_-]{43}$/u);

  const token = await trade(page.request, form(clientId, answer.code, pair));
  expect(token.status).toBe(200);
  expect(token.headers["cache-control"]).toBe("no-store");
  expect(token.body).toMatchObject({ token_type: "Bearer", scope: "kin:read kin:propose" });
  expect(token.body["refresh_token"]).toBeUndefined();
  expect(Number(token.body["expires_in"])).toBeGreaterThan(7 * 86_400 - 120);
  expect(Number(token.body["expires_in"])).toBeLessThanOrEqual(7 * 86_400);
  const accessToken = String(token.body["access_token"]);
  expect(accessToken).toMatch(/^kin_dlg_[A-Za-z0-9_-]{43}$/u);

  const listed = await mcpCall(page.request, accessToken, 1, "tools/list");
  expect(listed.status).toBe(200);
  const names = (listed.json?.result?.tools ?? []).map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["get_pool", "get_fairness", "propose_refill"]));
  // Every tool listed only reads or raises a proposal that waits; none approves or moves money.
  expect(names.filter((name) => !/^(get_|list_|check_|propose_)/u.test(name))).toEqual([]);
  expect(names.filter((name) => /approve/u.test(name))).toEqual([]);
  const approve = await mcpCall(page.request, accessToken, 2, "tools/call", { name: "approve_proposal", arguments: {} });
  expect(approve.json?.error).toMatchObject({ code: -32602, data: { reason: "unknown_tool" } });

  // The same code again was stolen or replayed: refused, and the token it bought stops working.
  const replay = await trade(page.request, form(clientId, answer.code, pair));
  expect(replay).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  expect((await mcpCall(page.request, accessToken, 3, "tools/list")).status).toBe(401);
});

test("the connections screen lists an assistant connected by signing in, and revoking it refuses its next call", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const pair = pkce();
  const answer = await consentYes(page, clientId, pair);
  const token = String((await trade(page.request, form(clientId, answer.code, pair))).body["access_token"]);
  expect((await mcpCall(page.request, token, 1, "tools/list")).status).toBe(200);

  await page.goto("/dashboard/circle/connections");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: CLIENT_NAME }) }).filter({ hasText: fill(english.openKin.list.token, { hint: token.slice(-4) }) });
  await expect(card).toContainText(english.openKin.list.oauth);
  await expect(card).toContainText(english.openKin.list.scope.read);
  await expectNoHorizontalOverflow(page);
  await card.getByRole("button", { name: fill(english.openKin.list.revokeFor, { label: CLIENT_NAME }) }).click();
  await expect(card).toContainText(english.openKin.list.revoked);
  expect((await mcpCall(page.request, token, 2, "tools/list")).status).toBe(401);
});

test("a wrong verifier spends the code, so the right one after it is refused too", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const pair = pkce();
  const answer = await consentYes(page, clientId, pair);
  expect(await trade(page.request, form(clientId, answer.code, pair, { code_verifier: pkce().verifier }))).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  expect(await trade(page.request, form(clientId, answer.code, pair))).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
});

test("a code traded by another client, to another redirect URI or with no verifier is refused", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const other = await registerClient(page.request, "Another client");
  const pair = pkce();
  const first = await consentYes(page, clientId, pair);
  expect(await trade(page.request, form(other, first.code, pair))).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  const second = await consentYes(page, clientId, pair);
  expect(await trade(page.request, form(clientId, second.code, pair, { redirect_uri: "http://127.0.0.1:45555/elsewhere" }))).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  const third = await consentYes(page, clientId, pair);
  const noVerifier = Object.fromEntries(Object.entries(form(clientId, third.code, pair)).filter(([name]) => name !== "code_verifier"));
  expect(await trade(page.request, noVerifier)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  expect((await trade(page.request, form("kin_cli_forged.client", third.code, pair))).status).toBe(401);
});

test("a code older than its minute is refused", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const pair = pkce();
  const answer = await consentYes(page, clientId, pair);
  await asOwner(async (query) => {
    await query("alter table oauth_codes disable trigger code_fixed");
    try {
      await query("update oauth_codes set created_at = now() - interval '3 minutes', expires_at = now() - interval '2 minutes' where code_hash = $1", [sha256(answer.code)]);
    } finally {
      await query("alter table oauth_codes enable trigger code_fixed");
    }
  });
  expect(await trade(page.request, form(clientId, answer.code, pair))).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
});

test("a request with an unregistered redirect URI is never redirected, and one without S256 PKCE goes back to the client refused", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const unregistered = await page.request.get(authorizeUrl(clientId, pkce(), { redirect_uri: "https://evil.example/steal" }), { maxRedirects: 0 });
  expect(unregistered.status()).toBe(400);
  expect(unregistered.headers()["location"]).toBeUndefined();
  const unknown = await page.request.get(authorizeUrl("kin_cli_forged.client", pkce()), { maxRedirects: 0 });
  expect(unknown.status()).toBe(400);

  const downgrades: Record<string, string | null>[] = [{ code_challenge: null }, { code_challenge_method: "plain" }, { code_challenge_method: null }];
  for (const change of downgrades) {
    const downgraded = await page.request.get(authorizeUrl(clientId, pkce(), change), { maxRedirects: 0 });
    expect(downgraded.status()).toBe(303);
    const location = new URL(downgraded.headers()["location"] ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("code")).toBeNull();
  }
  const approveScope = new URL((await page.request.get(authorizeUrl(clientId, pkce(), { scope: "kin:approve" }), { maxRedirects: 0 })).headers()["location"] ?? "");
  expect(approveScope.searchParams.get("error")).toBe("invalid_scope");
});

test("saying no sends the client access_denied and no code", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const answer = await catchRedirect(page);
  await page.goto(authorizeUrl(clientId, pkce()));
  await page.getByRole("button", { name: copy.deny }).click();
  await expect.poll(() => answer()?.error ?? null).toBe("access_denied");
  expect(answer()).toMatchObject({ code: null, state: "e2e-state", iss: E2E_APP_ORIGIN });
});

test("an observer is asked nothing they cannot grant, and the server refuses their yes", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const pair = pkce();
  const seat = await ownSeat();
  await asOwner((query) => query("update members set role = 'observer' where id = $1", [seat.memberId]));
  try {
    await page.goto(authorizeUrl(clientId, pair));
    await expect(page.getByRole("heading", { level: 1, name: fill(copy.title, { client: CLIENT_NAME }) })).toBeVisible();
    await expect(page.getByText(english.openKin.grant.observer)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.allow, exact: true })).toHaveCount(0);
    const query = new URL(page.url()).search.slice(1);
    const forced = await page.request.post("/api/oauth/consent", { headers: { origin: E2E_APP_ORIGIN }, data: { query, decision: "allow", scope: "read", days: 30 } });
    expect(forced.status()).toBe(403);
    expect(await forced.json()).toMatchObject({ ok: false, reason: "refused" });
    await expectNoHorizontalOverflow(page);
  } finally {
    await asOwner((query) => query("update members set role = 'organizer' where id = $1", [seat.memberId]));
  }
});

test("a demo visitor is sent to sign in with their own account, and the server refuses their yes", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    const clientId = await sharedClient(page.request);
    await startDemo(page);
    await page.goto(authorizeUrl(clientId, pkce()));
    await expect(page.getByRole("heading", { level: 1, name: copy.visitor.title })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.allow, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: copy.visitor.signIn })).toHaveAttribute("href", /\/sign-in\?next=/u);
    await expectNoHorizontalOverflow(page);
    const query = new URL(page.url()).search.slice(1);
    const forced = await page.request.post("/api/oauth/consent", { headers: { origin: E2E_APP_ORIGIN }, data: { query, decision: "allow", scope: "read", days: 30 } });
    expect(forced.status()).toBe(400);
    expect(await forced.json()).toMatchObject({ ok: false, reason: "visitor" });
  } finally {
    await context.close();
  }
});

test("a consent posted from another origin is refused", async ({ page }) => {
  const clientId = await sharedClient(page.request);
  const query = new URL(authorizeUrl(clientId, pkce()), E2E_APP_ORIGIN).search.slice(1);
  const forged = await page.request.post("/api/oauth/consent", { headers: { origin: "https://evil.example" }, data: { query, decision: "allow", scope: "propose", days: 90 } });
  expect(forged.status()).toBe(403);
});
