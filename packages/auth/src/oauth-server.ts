import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { DelegationScope } from "@kin/domain";

import { DELEGATION_LIFETIME_DAYS, DELEGATION_OAUTH_SCOPES, MAX_DELEGATION_LABEL } from "./delegation.ts";

/**
 * Kin as an OAuth 2.1 authorization server for its own MCP server
 * (docs/architecture.md section 13.4, decision 111), checked against the MCP
 * authorization specification of 2026-07-28, RFC 6749/OAuth 2.1, RFC 7636
 * (PKCE, S256 only), RFC 7591 (dynamic registration), RFC 8414 (metadata),
 * RFC 8707 (resource indicators), RFC 9207 (`iss` in the response) and the
 * client ID metadata document draft. Every function here is pure: the web
 * app reads the request, fetches what it must and keeps state in the database.
 *
 * The access token Kin issues is a delegation token, so the scopes are the
 * delegation scopes, announced as `kin:read` and `kin:propose`. No scope
 * approves, and no request can ask for one that does.
 */

export type OAuthError =
  | "invalid_request"
  | "unauthorized_client"
  | "access_denied"
  | "unsupported_response_type"
  | "invalid_scope"
  | "server_error"
  | "temporarily_unavailable"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "invalid_target"
  | "invalid_redirect_uri"
  | "invalid_client_metadata";

export type OAuthFailure = { readonly ok: false; readonly error: OAuthError; readonly description: string };

const fail = (error: OAuthError, description: string): OAuthFailure => ({ ok: false, error, description });

/** Every scope Kin grants, in the order a broader one includes the narrower. */
export const OAUTH_SCOPES = [DELEGATION_OAUTH_SCOPES.read, DELEGATION_OAUTH_SCOPES.propose] as const;

/** Scopes a client may ask for that Kin quietly does not grant: Kin issues no refresh token and no ID token. */
const IGNORED_SCOPES: ReadonlySet<string> = new Set(["offline_access", "openid", "profile", "email"]);

/** The delegation scope a request's `scope` asks for, or `null` for a scope Kin does not know. No scope at all asks to read. */
export function requestedScope(raw: string | null): DelegationScope | null {
  const asked = (raw ?? "").split(" ").filter((each) => each !== "" && !IGNORED_SCOPES.has(each));
  if (asked.some((each) => !(OAUTH_SCOPES as readonly string[]).includes(each))) return null;
  return asked.includes(DELEGATION_OAUTH_SCOPES.propose) ? "propose" : "read";
}

/** The `scope` a token answer names: proposing includes reading. */
export const grantedScope = (scope: DelegationScope): string => (scope === "propose" ? OAUTH_SCOPES.join(" ") : DELEGATION_OAUTH_SCOPES.read);

// PKCE (RFC 7636 section 4.1): 43 to 128 unreserved characters; the S256 challenge is 43 base64url characters.
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/u;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
export const isCodeVerifier = (value: string): boolean => VERIFIER.test(value);
export const isCodeChallenge = (value: string): boolean => CHALLENGE.test(value);

const CODE_PREFIX = "kin_code_";
const CODE_SHAPE = /^kin_code_[A-Za-z0-9_-]{43}$/u;

/** A new authorization code: 32 random bytes behind a prefix. Kin keeps only its SHA-256. */
export const newAuthorizationCode = (): string => `${CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
export const isAuthorizationCode = (value: string): boolean => CODE_SHAPE.test(value);
export const hashAuthorizationCode = (code: string): string => createHash("sha256").update(code, "utf8").digest("hex");

/** The longest redirect URI Kin accepts, and how many one client may register. */
export const MAX_REDIRECT_URI = 512;
export const MAX_REDIRECT_URIS = 10;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
// No space, no control character, nothing a browser would quietly rewrite.
const UNSAFE_CHARACTERS = /[\s\p{Cc}\\]/u;

/**
 * A redirect URI Kin will send a code to, or `null`: https anywhere, or http
 * to this machine's loopback only (MCP authorization, "Communication
 * security"), with no fragment and no user name or password in it.
 */
export function parseRedirectUri(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REDIRECT_URI || UNSAFE_CHARACTERS.test(raw) || raw.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url;
  return null;
}

const isLoopback = (url: URL) => url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/**
 * Whether `requested` is one of the client's redirect URIs: the very same
 * string, except that a loopback URI may name any port, as a native app
 * listens on whichever is free (RFC 8252 section 7.3, OAuth 2.1 section 8.4.2).
 */
export function redirectUriAllowed(registered: readonly string[], requested: string): boolean {
  const asked = parseRedirectUri(requested);
  if (asked === null) return false;
  return registered.some((each) => {
    if (each === requested) return true;
    const known = parseRedirectUri(each);
    return known !== null && isLoopback(known) && isLoopback(asked) && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search;
  });
}

const NAME_UNSAFE = /[<>{}\p{Cc}]/gu;

/** A client's own name, made safe to show and to keep as a delegation's label; `null` when nothing is left. */
export function cleanClientName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(NAME_UNSAFE, " ").replace(/\s+/gu, " ").trim();
  if (cleaned === "") return null;
  return [...cleaned].slice(0, MAX_DELEGATION_LABEL).join("").trim();
}

/** The label the delegation is kept under: the client's name, or the host it sends codes to. */
export const clientLabel = (name: string | null, redirectUri: string): string => name ?? cleanClientName(new URL(redirectUri).host) ?? "OAuth client";

export type ClientMetadata = { readonly ok: true; readonly name: string | null; readonly redirectUris: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const listOf = (value: unknown): readonly unknown[] | null => (Array.isArray(value) ? value : null);

/**
 * A client's metadata (RFC 7591 section 2), from a registration request or a
 * client ID metadata document. Kin serves public clients only: it never
 * issues a secret, and a document that names another way to authenticate
 * is refused, since Kin could not honour it. A registration that asks for a
 * secret is answered with `none`, as RFC 7591 lets a server replace what it
 * does not support.
 */
export function parseClientMetadata(input: unknown, source: "registration" | "document"): ClientMetadata | OAuthFailure {
  if (!isRecord(input)) return fail("invalid_client_metadata", "The client metadata must be a JSON object.");
  const uris = listOf(input["redirect_uris"]);
  if (uris === null || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) return fail("invalid_redirect_uri", `Give one to ${MAX_REDIRECT_URIS} redirect URIs.`);
  if (!uris.every((uri) => parseRedirectUri(uri) !== null)) return fail("invalid_redirect_uri", "Each redirect URI must be https, or http to localhost, 127.0.0.1 or [::1], with no fragment.");
  const grants = input["grant_types"];
  if (grants !== undefined && !listOf(grants)?.includes("authorization_code")) return fail("invalid_client_metadata", "Kin issues tokens for the authorization_code grant only.");
  const responses = input["response_types"];
  if (responses !== undefined && !listOf(responses)?.includes("code")) return fail("invalid_client_metadata", "Kin answers the code response type only.");
  const method = input["token_endpoint_auth_method"];
  if (source === "document" && method !== undefined && method !== "none") return fail("invalid_client_metadata", "Kin serves public clients only: token_endpoint_auth_method must be none.");
  return { ok: true, name: cleanClientName(input["client_name"]), redirectUris: [...new Set(uris as string[])] };
}

/** A client Kin registered, as its ID carries it. */
export type ClientRegistration = { readonly name: string | null; readonly redirectUris: readonly string[]; readonly issuedAt: number };

const CLIENT_PREFIX = "kin_cli_";

/** The key client IDs are signed with, derived from the server's signing key under its own label. */
export const clientRegistrationKey = (signingKey: string): Buffer => createHmac("sha256", signingKey).update("kin oauth client v1", "utf8").digest();

/**
 * A registered client's ID: its name and redirect URIs, signed. Kin keeps
 * no table of registrations, so anyone may register without filling one,
 * and nothing in a registration can be changed without the signature failing.
 */
export function signClientRegistration(key: Buffer, registration: ClientRegistration): string {
  const payload = Buffer.from(JSON.stringify({ n: registration.name, r: registration.redirectUris, t: registration.issuedAt }), "utf8").toString("base64url");
  return `${CLIENT_PREFIX}${payload}.${createHmac("sha256", key).update(payload, "utf8").digest("base64url")}`;
}

/** The registration a client ID carries, or `null` for any ID Kin did not sign. */
export function readClientRegistration(key: Buffer, clientId: string): ClientRegistration | null {
  if (!clientId.startsWith(CLIENT_PREFIX) || clientId.length > 2048) return null;
  const [payload, mac, ...rest] = clientId.slice(CLIENT_PREFIX.length).split(".");
  if (payload === undefined || mac === undefined || rest.length > 0) return null;
  const expected = createHmac("sha256", key).update(payload, "utf8").digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed["t"] !== "number") return null;
  const metadata = parseClientMetadata({ client_name: parsed["n"], redirect_uris: parsed["r"] }, "registration");
  return metadata.ok ? { name: metadata.name, redirectUris: metadata.redirectUris, issuedAt: parsed["t"] } : null;
}

export const isRegisteredClientId = (clientId: string): boolean => clientId.startsWith(CLIENT_PREFIX);

/**
 * A client ID metadata document's URL, or `null` (the draft's section 3):
 * https, a path, no fragment, no user name or password, no dot segments, and
 * here also no port, no query and a host that is a name, not an address.
 */
export function parseClientIdUrl(clientId: string): URL | null {
  if (clientId.length > 2048 || UNSAFE_CHARACTERS.test(clientId) || clientId.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.href !== clientId || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.search !== "") return null;
  if (url.pathname === "/" || /\/\.\.?(\/|$)/u.test(clientId.slice(url.origin.length))) return null;
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith("[") || /^[0-9.]+$/u.test(host) || host === "localhost" || host.endsWith(".localhost")) return null;
  return url;
}

/** A resource indicator (RFC 8707) compared the way the MCP specification asks: scheme and host in any case, no trailing slash. */
function canonicalResource(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hash !== "" || raw.includes("#")) return null;
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

/** Whether the client asked for Kin's MCP server. A request that names no resource means the only one Kin has. */
export function resourceMatches(raw: string | null, resource: string): boolean {
  if (raw === null) return true;
  const asked = canonicalResource(raw);
  return asked !== null && asked === canonicalResource(resource);
}

/** The authorization request once its client and redirect URI are trusted. */
export type AuthorizationRequest = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string | null;
  readonly codeChallenge: string;
  readonly scope: DelegationScope;
};

export type ParamReader = { readonly getAll: (name: string) => string[] };

/** The one value of a parameter: `undefined` when absent, `null` when it was sent more than once, which OAuth forbids. */
function single(params: ParamReader, name: string): string | null | undefined {
  const values = params.getAll(name);
  if (values.length > 1) return null;
  return values[0];
}

const STATE = /^[ -~]{1,1024}$/u;

/** The client ID and redirect URI an authorization request names, before anything else is read. A problem with either is shown, never redirected to. */
export function clientOfRequest(params: ParamReader): { readonly ok: true; readonly clientId: string; readonly redirectUri: string } | OAuthFailure {
  const clientId = single(params, "client_id");
  const redirectUri = single(params, "redirect_uri");
  if (typeof clientId !== "string" || clientId === "" || clientId.length > 2048) return fail("invalid_client", "The request names no client.");
  if (typeof redirectUri !== "string" || parseRedirectUri(redirectUri) === null) return fail("invalid_request", "The request names no usable redirect URI.");
  return { ok: true, clientId, redirectUri };
}

/**
 * The rest of an authorization request (OAuth 2.1 section 4.1.1), once the
 * client and redirect URI are trusted: the code response type, a PKCE S256
 * challenge (no other method, and never none), a known scope and Kin's own
 * MCP server as the resource.
 */
export function parseAuthorizationRequest(params: ParamReader, trusted: { readonly clientId: string; readonly redirectUri: string }, resource: string): { readonly ok: true; readonly request: AuthorizationRequest } | OAuthFailure {
  for (const name of ["response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"]) {
    if (single(params, name) === null) return fail("invalid_request", `The ${name} parameter was sent more than once.`);
  }
  if (single(params, "response_type") !== "code") return fail("unsupported_response_type", "Kin answers response_type=code only.");
  const challenge = single(params, "code_challenge");
  if (single(params, "code_challenge_method") !== "S256" || typeof challenge !== "string" || !isCodeChallenge(challenge)) return fail("invalid_request", "PKCE is required, with code_challenge_method=S256.");
  const scope = requestedScope(single(params, "scope") ?? null);
  if (scope === null) return fail("invalid_scope", `Kin grants ${OAUTH_SCOPES.join(" and ")} only. No scope approves.`);
  if (!resourceMatches(single(params, "resource") ?? null, resource)) return fail("invalid_target", "The resource must be Kin's MCP server.");
  const state = single(params, "state");
  if (state !== undefined && state !== null && !STATE.test(state)) return fail("invalid_request", "The state is not printable text of up to 1,024 characters.");
  return { ok: true, request: { ...trusted, state: state ?? null, codeChallenge: challenge, scope } };
}

/** The lifetimes a member may choose on the consent screen, in days: the same as the Connected assistants screen. */
export const isConsentLifetime = (days: unknown): days is number => typeof days === "number" && (DELEGATION_LIFETIME_DAYS as readonly number[]).includes(days);

/**
 * Where the browser goes back to the client: the redirect URI with the code
 * (or the error), the state and the issuer (RFC 9207) added as query
 * parameters, never written into the string by hand.
 */
export function authorizationResponse(redirectUri: string, issuer: string, outcome: { readonly code: string } | { readonly error: OAuthError; readonly description?: string }, state: string | null): string {
  const url = new URL(redirectUri);
  if ("code" in outcome) url.searchParams.set("code", outcome.code);
  else {
    url.searchParams.set("error", outcome.error);
    if (outcome.description) url.searchParams.set("error_description", outcome.description);
  }
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.href;
}

/**
 * A token request for the authorization code grant (OAuth 2.1 section 4.1.3),
 * the only grant Kin serves. OAuth 2.1 no longer asks for the redirect URI
 * again, since PKCE binds the code to the client; when a client does send it,
 * it must be the one the code was issued for.
 */
export type TokenRequest = { readonly code: string; readonly redirectUri: string | null; readonly clientId: string; readonly codeVerifier: string; readonly resource: string | null };

/** The client ID an `Authorization: Basic` header names, for a public client that sends its ID that way with an empty secret. */
function basicClientId(header: string | null): string | null | undefined {
  if (header === null) return undefined;
  const match = /^basic +([A-Za-z0-9+/=]+)\s*$/iu.exec(header);
  if (!match?.[1]) return null;
  const [id, secret = ""] = Buffer.from(match[1], "base64").toString("utf8").split(":");
  if (!id || secret !== "") return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

export function parseTokenRequest(form: ParamReader, authorization: string | null): { readonly ok: true; readonly request: TokenRequest } | OAuthFailure {
  for (const name of ["grant_type", "code", "redirect_uri", "client_id", "code_verifier", "resource"]) {
    if (single(form, name) === null) return fail("invalid_request", `The ${name} parameter was sent more than once.`);
  }
  if (single(form, "grant_type") !== "authorization_code") return fail("unsupported_grant_type", "Kin serves the authorization_code grant only, and issues no refresh token.");
  if (single(form, "client_secret") !== undefined) return fail("invalid_client", "Kin's clients are public: send no client secret.");
  const fromHeader = basicClientId(authorization);
  if (fromHeader === null) return fail("invalid_client", "Kin's clients are public: send the client ID with no secret.");
  const fromForm = single(form, "client_id");
  if (fromHeader !== undefined && fromForm !== undefined && fromHeader !== fromForm) return fail("invalid_client", "The client ID was given twice, differently.");
  const clientId = fromForm ?? fromHeader;
  const code = single(form, "code");
  const redirectUri = single(form, "redirect_uri");
  const codeVerifier = single(form, "code_verifier");
  if (typeof clientId !== "string" || clientId === "" || clientId.length > 2048) return fail("invalid_client", "The request names no client.");
  if (typeof code !== "string" || !isAuthorizationCode(code)) return fail("invalid_grant", "The authorization code is not valid.");
  if (typeof codeVerifier !== "string" || !isCodeVerifier(codeVerifier)) return fail("invalid_grant", "The PKCE code_verifier is missing or malformed.");
  if (redirectUri === "") return fail("invalid_grant", "The redirect_uri is empty.");
  return { ok: true, request: { code, redirectUri: redirectUri ?? null, clientId, codeVerifier, resource: single(form, "resource") ?? null } };
}
