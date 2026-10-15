import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { cognitoClaims, createTokenSigner } from "@kin/auth/testing";

/**
 * A stand-in for Cognito, for the end-to-end tests only. It speaks the same
 * authorization code flow with PKCE, signs tokens shaped like Cognito's and
 * publishes its key, so the app's real sign-in code runs unchanged against it.
 * It signs in one test person at once, without a form.
 */

export const IDENTITY_PROVIDER = {
  port: 3101,
  clientId: "kin-e2e",
  person: { sub: "e2e-person", email: "sam@example.com", name: "Sam Rivera" },
} as const;

const issuer = `http://localhost:${IDENTITY_PROVIDER.port}`;
const redirectUri = "http://localhost:3100/auth/callback";
const logoutUri = "http://localhost:3100/";
const signer = createTokenSigner("e2e-key");

type PendingCode = { challenge: string; nonce: string };
const codes = new Map<string, PendingCode>();
const refreshTokens = new Set<string>();

function tokens(nonce?: string, refresh = true) {
  const claims = cognitoClaims({ issuer, clientId: IDENTITY_PROVIDER.clientId, ...IDENTITY_PROVIDER.person, nonce, groups: ["family_member"] });
  const refreshToken = randomUUID();
  if (refresh) refreshTokens.add(refreshToken);
  return {
    access_token: signer.sign(claims.access),
    id_token: signer.sign(claims.id),
    token_type: "Bearer",
    expires_in: 3600,
    ...(refresh ? { refresh_token: refreshToken } : {}),
  };
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function redirect(response: ServerResponse, location: string) {
  response.writeHead(302, { location }).end();
}

async function form(request: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return new URLSearchParams(body);
}

function authorize(url: URL, response: ServerResponse) {
  const params = url.searchParams;
  if (params.get("client_id") !== IDENTITY_PROVIDER.clientId || params.get("redirect_uri") !== redirectUri) {
    return send(response, 400, { error: "unauthorized_client" });
  }
  const back = new URL(redirectUri);
  const state = params.get("state") ?? "";
  back.searchParams.set("state", state);
  const challenge = params.get("code_challenge");
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" || !challenge) {
    back.searchParams.set("error", "invalid_request");
    return redirect(response, back.href);
  }
  const code = randomUUID();
  codes.set(code, { challenge, nonce: params.get("nonce") ?? "" });
  back.searchParams.set("code", code);
  return redirect(response, back.href);
}

async function token(request: IncomingMessage, response: ServerResponse) {
  const params = await form(request);
  if (params.get("client_id") !== IDENTITY_PROVIDER.clientId) return send(response, 400, { error: "invalid_client" });

  if (params.get("grant_type") === "authorization_code") {
    const pending = codes.get(params.get("code") ?? "");
    codes.delete(params.get("code") ?? "");
    const verifier = params.get("code_verifier") ?? "";
    const proved = pending && createHash("sha256").update(verifier).digest("base64url") === pending.challenge;
    if (!proved || params.get("redirect_uri") !== redirectUri) return send(response, 400, { error: "invalid_grant" });
    return send(response, 200, tokens(pending.nonce || undefined));
  }
  if (params.get("grant_type") === "refresh_token" && refreshTokens.has(params.get("refresh_token") ?? "")) {
    return send(response, 200, tokens(undefined, false));
  }
  return send(response, 400, { error: "invalid_grant" });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", issuer);
  if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true });
  if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") return send(response, 200, signer.jwks);
  // Cognito's sign-up page takes the authorize parameters and answers the same way.
  if (request.method === "GET" && (url.pathname === "/oauth2/authorize" || url.pathname === "/signup")) return authorize(url, response);
  if (request.method === "POST" && url.pathname === "/oauth2/token") {
    token(request, response).catch(() => send(response, 500, { error: "server_error" }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/logout") {
    return url.searchParams.get("logout_uri") === logoutUri ? redirect(response, logoutUri) : send(response, 400, { error: "invalid_logout_uri" });
  }
  return send(response, 404, { error: "not_found" });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(IDENTITY_PROVIDER.port);
}
