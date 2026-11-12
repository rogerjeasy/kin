import { createHash, randomBytes } from "node:crypto";

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readDatabaseConfig } from "@kin/config";
import { connect } from "@kin/db";

import { E2E_DATABASE } from "./database-settings.ts";
import { IDENTITY_PROVIDER } from "./identity-provider.ts";
import { E2E_APP_ORIGIN } from "./ports.ts";

/**
 * An MCP client as the OAuth tests play it (decision 112): it registers,
 * draws a PKCE pair, sends the person to Kin's authorization endpoint, catches
 * the code at its loopback redirect URI and trades it. Nothing here is Kin's
 * own code: it speaks to Kin only over HTTP, as a real client does.
 */

export const REDIRECT_URI = "http://127.0.0.1:45555/callback";
export const RESOURCE = `${E2E_APP_ORIGIN}/api/mcp`;

export type Pkce = { readonly verifier: string; readonly challenge: string };

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Registers a public client (RFC 7591) and returns its ID. */
export async function registerClient(request: APIRequestContext, name = "E2E assistant", redirectUris: readonly string[] = [REDIRECT_URI]): Promise<string> {
  const response = await request.post("/api/oauth/register", { data: { client_name: name, redirect_uris: redirectUris, grant_types: ["authorization_code"], token_endpoint_auth_method: "none" } });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { client_id: string; token_endpoint_auth_method: string };
  expect(body.token_endpoint_auth_method).toBe("none");
  return body.client_id;
}

/** The authorization endpoint's address for a request; `change` overrides or (with null) removes a parameter. */
export function authorizeUrl(clientId: string, pair: Pkce, change: Record<string, string | null> = {}): string {
  const params: Record<string, string | null> = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: pair.challenge, code_challenge_method: "S256", state: "e2e-state", scope: "kin:read", resource: RESOURCE, ...change };
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== null) query.set(name, value);
  return `/api/oauth/authorize?${query.toString()}`;
}

export type Answer = { readonly code: string | null; readonly state: string | null; readonly iss: string | null; readonly error: string | null };

/** Catches the browser's arrival at the client's loopback redirect URI, as the client's own little server would. */
export async function catchRedirect(page: Page): Promise<() => Answer | null> {
  let answer: Answer | null = null;
  await page.route("http://127.0.0.1:45555/**", async (route) => {
    const url = new URL(route.request().url());
    answer = { code: url.searchParams.get("code"), state: url.searchParams.get("state"), iss: url.searchParams.get("iss"), error: url.searchParams.get("error") };
    await route.fulfill({ status: 200, contentType: "text/plain", body: "You can close this window." });
  });
  return () => answer;
}

/** Trades a code at the token endpoint, form-encoded as OAuth requires. */
export async function trade(request: APIRequestContext, form: Record<string, string>) {
  const response = await request.post("/api/oauth/token", { form });
  return { status: response.status(), headers: response.headers(), body: (await response.json()) as Record<string, unknown> };
}

/** One JSON-RPC request to Kin's MCP endpoint with a bearer token, from no browser. */
export async function mcpCall(request: APIRequestContext, token: string, id: number, method: string, params: Record<string, unknown> = {}) {
  const response = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
    data: { jsonrpc: "2.0", id, method, params },
  });
  const text = await response.text();
  return { status: response.status(), json: text === "" ? null : (JSON.parse(text) as { result?: { tools?: { name: string }[] }; error?: { code: number; data?: { reason?: string } } }) };
}

/** Runs SQL as the database's owner, for the few states no screen reaches: a code past its minute, a seat made an observer's. */
export async function asOwner<T>(work: (query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
  const inherited = process.env[E2E_DATABASE.envKey];
  if (!inherited) throw new Error("The end-to-end database settings were not passed to this worker");
  const admin = connect(readDatabaseConfig(JSON.parse(inherited) as Record<string, string>, ["admin"]), "admin");
  try {
    return await work((text, values) => admin.$client.query(text, values));
  } finally {
    await admin.$client.end();
  }
}

/** The signed-in person's own seat in their real circle. */
export async function ownSeat(): Promise<{ circleId: string; memberId: string }> {
  return asOwner(async (query) => {
    const found = await query(
      `select m.circle_id, m.id from members m join circles c on c.id = m.circle_id
       where m.user_id = $1 and m.status = 'active' and not c.demo and c.status = 'active' order by m.joined_at limit 1`,
      [IDENTITY_PROVIDER.person.sub],
    );
    const row = found.rows[0];
    if (!row) throw new Error("The signed-in person has no real circle");
    return { circleId: String(row["circle_id"]), memberId: String(row["id"]) };
  });
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
