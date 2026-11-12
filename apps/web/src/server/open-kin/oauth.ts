import {
  OAUTH_SCOPES,
  authorizationResponse,
  authorize,
  clientLabel,
  clientOfRequest,
  clientRegistrationKey,
  delegationTokenHint,
  grantedScope,
  hashAuthorizationCode,
  hashDelegationToken,
  isConsentLifetime,
  isDelegationScope,
  newAuthorizationCode,
  newDelegationToken,
  parseAuthorizationRequest,
  parseClientMetadata,
  parseTokenRequest,
  pkceChallenge,
  redirectUriAllowed,
  resourceMatches,
  signClientRegistration,
  type AuthorizationRequest,
  type OAuthError,
  type ParamReader,
} from "@kin/auth";
import { OAuthConsentError, asPerson, createAuthorizationCode, redeemAuthorizationCode, type CircleSnapshot, type Database, type OAuthConsentRefusal } from "@kin/db";

import { oauthConsentRoute } from "@/content/dashboard-routes";
import { routes } from "@/content/site-routes";

import { clientKey } from "../check-link";
import { createRateLimiter } from "../model";
import { agencySigningKey } from "./agency";
import { MCP_PATH } from "./mcp";
import { clientResolver, type ClientResolver, type OAuthClient } from "./oauth-clients";

/**
 * Kin as the OAuth 2.1 authorization server of its own MCP server
 * (docs/architecture.md section 13.4, decision 112). A client discovers Kin
 * from the MCP endpoint's 401, registers (or names itself by a client ID
 * metadata document), and sends the member to Kin's consent screen. Their yes
 * is a sixty-second code; the client trades it, with its PKCE verifier, for
 * a delegation token. From there nothing is new: the scope, the role table,
 * the refusals, the rate limit, the record and revocation are the delegation's.
 */

export const OAUTH_PATHS = {
  metadata: "/.well-known/oauth-authorization-server",
  authorize: "/api/oauth/authorize",
  token: "/api/oauth/token",
  register: "/api/oauth/register",
  consent: "/api/oauth/consent",
} as const;

/** The consent screen, among the circle's own screens so signing in leads back to it. */
export const CONSENT_PAGE = oauthConsentRoute;

/** The one resource Kin's tokens are for (RFC 8707): its MCP endpoint. */
export const mcpResource = (origin: string): string => `${origin}${MCP_PATH}`;

/**
 * Each address may open 120 authorization requests in ten minutes, at the
 * endpoint, the consent screen and its answer together: each one may make
 * Kin fetch a stranger's client ID metadata document.
 */
const authorizationLimiter = createRateLimiter(120, 10 * 60_000, { whenFull: "forgetOldest" });

/** Counts one authorization request from the address the headers name, or says it is one too many. */
export function allowAuthorization(headers: Headers, now = Date.now()): boolean {
  const from = clientKey(headers);
  if (!authorizationLimiter.allows(from, now)) return false;
  authorizationLimiter.record(from, now);
  return true;
}

let resolver: ClientResolver | undefined;

/** The clients this server knows, with the signing key read on first use, never at build time. */
export function oauthClients(): ClientResolver {
  resolver ??= clientResolver(agencySigningKey());
  return resolver;
}

/** The authorization server metadata (RFC 8414) at the origin, which is the issuer. */
export function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_PATHS.token}`,
    registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    // No refresh token: a delegation lasts the one to ninety days the member chose, then they say yes again.
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}${routes.developers}`,
  };
}

export type AuthorizationCheck =
  /** A request Kin can put to the member. */
  | { readonly kind: "ask"; readonly client: OAuthClient; readonly request: AuthorizationRequest }
  /** A request the client must hear was refused, at its own redirect URI. */
  | { readonly kind: "redirect"; readonly location: string }
  /** The client or its redirect URI cannot be trusted: shown to the person, never redirected to. */
  | { readonly kind: "refuse"; readonly description: string };

export type OAuthServices = { readonly origin: string; readonly clients: ClientResolver };

const printableState = (params: ParamReader): string | null => {
  const [state, ...more] = params.getAll("state");
  return state !== undefined && more.length === 0 && /^[ -~]{1,1024}$/u.test(state) ? state : null;
};

/**
 * Reads an authorization request: first who the client is and whether the
 * redirect URI is one it registered (otherwise nothing is redirected
 * anywhere), then the rest, whose problems go back to the client.
 */
export async function checkAuthorization(params: ParamReader, services: OAuthServices): Promise<AuthorizationCheck> {
  const named = clientOfRequest(params);
  if (!named.ok) return { kind: "refuse", description: named.description };
  const client = await services.clients(named.clientId);
  if (client === null) return { kind: "refuse", description: "Kin does not know this client." };
  if (!redirectUriAllowed(client.redirectUris, named.redirectUri)) return { kind: "refuse", description: "The redirect URI is not one this client registered." };
  const parsed = parseAuthorizationRequest(params, named, mcpResource(services.origin));
  if (!parsed.ok) return { kind: "redirect", location: authorizationResponse(named.redirectUri, services.origin, { error: parsed.error, description: parsed.description }, printableState(params)) };
  return { kind: "ask", client, request: parsed.request };
}

export type ConsentContext = OAuthServices & {
  readonly db: Database;
  readonly userId: string;
  /** Only a person who signed in authorizes a client. A demo visitor never does. */
  readonly signedIn: boolean;
  readonly circle: CircleSnapshot;
};

export type ConsentResult = { readonly ok: true; readonly redirect: string } | { readonly ok: false; readonly reason: OAuthConsentRefusal | "visitor" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const MAX_QUERY = 6_000;

type ConsentInput = { readonly query: string; readonly decision: "deny" } | { readonly query: string; readonly decision: "allow"; readonly scope: "read" | "propose"; readonly days: number };

function parseConsent(input: unknown): ConsentInput | null {
  if (!isRecord(input) || typeof input["query"] !== "string" || input["query"].length > MAX_QUERY) return null;
  const { query, decision, scope, days } = input;
  if (decision === "deny" && Object.keys(input).every((key) => key === "query" || key === "decision")) return { query, decision };
  if (decision !== "allow" || !Object.keys(input).every((key) => ["query", "decision", "scope", "days"].includes(key))) return null;
  return isDelegationScope(scope) && isConsentLifetime(days) ? { query, decision, scope, days } : null;
}

/**
 * The member's answer on the consent screen. The request is read again from
 * the query the screen was opened with, so nothing the browser sends can
 * change the client, the redirect URI or the challenge. Yes keeps a code for
 * the member's own seat; no tells the client `access_denied`. Either way the
 * answer is where the browser goes next.
 */
export async function answerConsent(context: ConsentContext, input: unknown): Promise<ConsentResult> {
  if (!context.signedIn) return { ok: false, reason: "visitor" };
  const consent = parseConsent(input);
  if (consent === null) return { ok: false, reason: "invalid" };
  const check = await checkAuthorization(new URLSearchParams(consent.query), context);
  if (check.kind === "refuse") return { ok: false, reason: "invalid" };
  if (check.kind === "redirect") return { ok: true, redirect: check.location };
  const { request, client } = check;
  // Anyone signed in may say no, an observer included; only a seat that may connect an assistant, in a real circle, says yes.
  if (consent.decision === "deny") return { ok: true, redirect: authorizationResponse(request.redirectUri, context.origin, { error: "access_denied", description: "The member said no." }, request.state) };
  if (context.circle.circle.demo) return { ok: false, reason: "demo_only" };
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "delegation.grant").allowed) return { ok: false, reason: "refused" };
  const code = newAuthorizationCode();
  try {
    await asPerson(context.db, context.userId, (tx) =>
      createAuthorizationCode(tx, {
        circleId: context.circle.circle.id,
        codeHash: hashAuthorizationCode(code),
        clientId: request.clientId,
        clientName: clientLabel(client.name, request.redirectUri),
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scope: consent.scope,
        days: consent.days,
        resource: mcpResource(context.origin),
      }),
    );
  } catch (error) {
    if (error instanceof OAuthConsentError) return { ok: false, reason: error.reason };
    throw error;
  }
  return { ok: true, redirect: authorizationResponse(request.redirectUri, context.origin, { code }, request.state) };
}

export type OAuthReply = { readonly status: number; readonly body: Record<string, unknown> };

const oauthError = (status: number, error: OAuthError, description: string): OAuthReply => ({ status, body: { error, error_description: description } });

/**
 * `POST /api/oauth/token`: the authorization code grant. The code is spent
 * by the first attempt, so a wrong verifier, client or redirect URI leaves
 * nothing to try again with; the token is a new delegation token, returned
 * once and kept only as its SHA-256.
 */
export async function exchangeToken(context: OAuthServices & { readonly db: Database; readonly now?: () => number }, form: ParamReader, authorization: string | null): Promise<OAuthReply> {
  const parsed = parseTokenRequest(form, authorization);
  if (!parsed.ok) return oauthError(parsed.error === "invalid_client" ? 401 : 400, parsed.error, parsed.description);
  const { request } = parsed;
  if ((await context.clients(request.clientId)) === null) return oauthError(401, "invalid_client", "Kin does not know this client.");
  const resource = mcpResource(context.origin);
  if (!resourceMatches(request.resource, resource)) return oauthError(400, "invalid_target", "The resource must be Kin's MCP server.");
  const token = newDelegationToken();
  const redeemed = await redeemAuthorizationCode(context.db, {
    codeHash: hashAuthorizationCode(request.code),
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: pkceChallenge(request.codeVerifier),
    resource,
    tokenHash: hashDelegationToken(token),
    tokenHint: delegationTokenHint(token),
  });
  if (!redeemed.ok) {
    if (redeemed.error === "too_many") return oauthError(400, "invalid_grant", "The member already has five live assistants. They can revoke one on Kin's Connected assistants screen.");
    if (redeemed.error === "invalid_target") return oauthError(400, "invalid_target", "The resource must be Kin's MCP server.");
    return oauthError(400, "invalid_grant", "The authorization code is not valid, has expired, was used already, or does not match this client, redirect URI and verifier.");
  }
  const now = (context.now ?? Date.now)();
  return {
    status: 200,
    body: { access_token: token, token_type: "Bearer", expires_in: Math.max(0, Math.floor((redeemed.expiresAt.getTime() - now) / 1000)), scope: grantedScope(redeemed.scope) },
  };
}

/**
 * `POST /api/oauth/register` (RFC 7591): any client may register, for a
 * public client ID that carries its name and redirect URIs, signed. Kin
 * stores nothing and issues no secret.
 */
export function registerClient(signingKey: string | null, input: unknown, now: number): OAuthReply {
  if (signingKey === null) return oauthError(503, "temporarily_unavailable", "Client registration is not switched on here.");
  const metadata = parseClientMetadata(input, "registration");
  if (!metadata.ok) return oauthError(400, metadata.error, metadata.description);
  const issuedAt = Math.floor(now / 1000);
  const clientId = signClientRegistration(clientRegistrationKey(signingKey), { name: metadata.name, redirectUris: metadata.redirectUris, issuedAt });
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      ...(metadata.name === null ? {} : { client_name: metadata.name }),
      redirect_uris: metadata.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPES.join(" "),
    },
  };
}

/** Headers for the documents and endpoints a client reaches from anywhere, a browser-based one included. Nothing here reads a cookie. */
export const OPEN_CORS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "600",
};

/** An OAuth reply as the token and registration endpoints send it: JSON, never cached. */
export const oauthResponse = (reply: OAuthReply): Response =>
  Response.json(reply.body, { status: reply.status, headers: { ...OPEN_CORS, "cache-control": "no-store", pragma: "no-cache" } });
