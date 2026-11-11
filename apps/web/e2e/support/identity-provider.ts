import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { cognitoClaims, createTokenSigner } from "@kin/auth/testing";

import { E2E_APP_ORIGIN, E2E_PORTS } from "./ports.ts";
import { newTotpSecret, totpCode } from "./totp.ts";

/**
 * A stand-in for Cognito, for the end-to-end tests only. It speaks the same
 * authorization code flow with PKCE, signs tokens shaped like Cognito's and
 * publishes its key, so the app's real sign-in code runs unchanged against it.
 * It signs in one test person at once, without a form.
 */

export const IDENTITY_PROVIDER = {
  port: E2E_PORTS.identityProvider,
  clientId: "kin-e2e",
  person: { sub: "e2e-person", email: "sam@example.com", name: "Sam Rivera" },
} as const;

const issuer = `http://localhost:${IDENTITY_PROVIDER.port}`;
const redirectUri = `${E2E_APP_ORIGIN}/auth/callback`;
const logoutUri = `${E2E_APP_ORIGIN}/`;
const signer = createTokenSigner("e2e-key");

/** What Cognito's step-up returns for a person with an authenticator app: a password and its code. */
const STEP_UP_METHODS = ["pwd", "otp", "mfa"] as const;
const PASSWORD_ONLY = ["pwd"] as const;
const SELF_SERVICE_SCOPE = "aws.cognito.signin.user.admin";

type PendingCode = { challenge: string; nonce: string; stepUp: boolean };
const codes = new Map<string, PendingCode>();
const refreshTokens = new Set<string>();
// A test can ask for the next step-up to come back with one factor only, as
// if the person had skipped their authenticator app.
let nextStepUpOneFactor = false;

// Like Cognito, the stand-in keeps each person's groups and authenticator app,
// and puts in tokens only what it holds: nobody is in a group until Kin adds them.
const groups = new Set<string>();
const authenticator: { pending: string | null; enabled: boolean } = { pending: null, enabled: false };

function tokens(nonce?: string, refresh = true, methods: readonly string[] | null = null) {
  const stepUp = methods ? { amr: methods, acr: methods.includes("otp") ? "urn:cognito:loa:4" : "urn:cognito:loa:1", jti: randomUUID() } : {};
  const claims = cognitoClaims({ issuer, clientId: IDENTITY_PROVIDER.clientId, ...IDENTITY_PROVIDER.person, nonce, groups: [...groups], ...stepUp });
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
  // Like Cognito: a step-up asks for a fresh sign-in at a level, and the
  // tokens say which methods the person completed.
  const stepUp = params.get("acr_values") !== null && params.get("prompt") === "login" && params.get("max_age") === "0";
  codes.set(code, { challenge, nonce: params.get("nonce") ?? "", stepUp });
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
    return send(response, 200, tokens(pending.nonce || undefined, true, pending.stepUp ? stepUpMethods() : null));
  }
  if (params.get("grant_type") === "refresh_token" && refreshTokens.has(params.get("refresh_token") ?? "")) {
    return send(response, 200, tokens(undefined, false));
  }
  return send(response, 400, { error: "invalid_grant" });
}

/** The factors a step-up proves: the authenticator's only once the person has one, as with Cognito's level 4. */
function stepUpMethods(): readonly string[] {
  const oneFactor = nextStepUpOneFactor;
  nextStepUpOneFactor = false;
  return authenticator.enabled && !oneFactor ? STEP_UP_METHODS : PASSWORD_ONLY;
}

function apiError(response: ServerResponse, type: string) {
  response.writeHead(400, { "content-type": "application/x-amz-json-1.1" }).end(JSON.stringify({ __type: type, message: type }));
}

/** The access token's claims, if it is one this stand-in signed for the person. The signature was checked by Kin; the stand-in checks the person and the scope. */
function accessClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return claims["token_use"] === "access" && claims["sub"] === IDENTITY_PROVIDER.person.sub ? claims : null;
  } catch {
    return null;
  }
}

/**
 * Cognito's JSON API, for the calls Kin makes: a person's own authenticator
 * app, with their access token, and adding them to a group, with the web
 * app's AWS identity (whose signature the stand-in does not check).
 */
async function userPoolApi(request: IncomingMessage, response: ServerResponse) {
  let raw = "";
  for await (const chunk of request) raw += String(chunk);
  const body = JSON.parse(raw || "{}") as Record<string, unknown>;
  const operation = String(request.headers["x-amz-target"] ?? "").replace("AWSCognitoIdentityProviderService.", "");
  if (operation === "AdminAddUserToGroup") {
    if (body["Username"] !== IDENTITY_PROVIDER.person.sub || typeof body["GroupName"] !== "string") return apiError(response, "UserNotFoundException");
    groups.add(body["GroupName"]);
    return send(response, 200, {});
  }
  const claims = accessClaims(body["AccessToken"]);
  if (claims === null || !String(claims["scope"] ?? "").split(" ").includes(SELF_SERVICE_SCOPE)) return apiError(response, "NotAuthorizedException");
  if (operation === "GetUser") return send(response, 200, { Username: IDENTITY_PROVIDER.person.sub, ...(authenticator.enabled ? { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"], PreferredMfaSetting: "SOFTWARE_TOKEN_MFA" } : {}) });
  if (operation === "AssociateSoftwareToken") {
    authenticator.pending = newTotpSecret(randomBytes);
    return send(response, 200, { SecretCode: authenticator.pending });
  }
  if (operation === "VerifySoftwareToken") {
    const code = String(body["UserCode"] ?? "");
    const pending = authenticator.pending;
    if (pending === null) return apiError(response, "SoftwareTokenMFANotFoundException");
    if (![-1, 0, 1].some((step) => totpCode(pending, new Date(), step) === code)) return apiError(response, "EnableSoftwareTokenMFAException");
    authenticator.enabled = true;
    authenticator.pending = null;
    return send(response, 200, { Status: "SUCCESS" });
  }
  if (operation === "SetUserMFAPreference") return send(response, 200, {});
  return apiError(response, "UnknownOperationException");
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", issuer);
  if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true });
  if (request.method === "POST" && url.pathname === "/test/next-step-up-without-mfa") {
    nextStepUpOneFactor = true;
    return send(response, 200, { ok: true });
  }
  if (request.method === "GET" && url.pathname === "/test/account") return send(response, 200, { groups: [...groups].toSorted(), authenticator: authenticator.enabled });
  if (request.method === "POST" && url.pathname === "/" && request.headers["x-amz-target"]) {
    userPoolApi(request, response).catch(() => send(response, 500, { __type: "InternalErrorException" }));
    return;
  }
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
