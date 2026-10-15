import type { AuthConfig } from "@kin/config";

import { AuthError } from "./auth-error.ts";
import { pkceChallenge, type SignInSecrets } from "./pkce.ts";

/** The path the identity provider sends a person back to after signing in. */
export const CALLBACK_PATH = "/auth/callback";

const SCOPES = "openid email profile";

/** The languages Cognito's managed login pages are shown in, among Kin's own. */
const LOGIN_LANGUAGES = new Set(["en", "fr", "de", "it", "es"]);

export function callbackUrl(config: AuthConfig): string {
  return `${config.webOrigin}${CALLBACK_PATH}`;
}

/** Where to send the browser to sign in, carrying this sign-in's secrets. */
export function authorizeUrl(config: AuthConfig, secrets: SignInSecrets, language: string): string {
  const url = new URL("/oauth2/authorize", config.loginUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: callbackUrl(config),
    scope: SCOPES,
    state: secrets.state,
    nonce: secrets.nonce,
    code_challenge: pkceChallenge(secrets.verifier),
    code_challenge_method: "S256",
    ...(LOGIN_LANGUAGES.has(language) ? { lang: language } : {}),
  }).toString();
  return url.href;
}

/** Where to send the browser to end the identity provider's own session too. */
export function logoutUrl(config: AuthConfig): string {
  const url = new URL("/logout", config.loginUrl);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: `${config.webOrigin}/` }).toString();
  return url.href;
}

/** The tokens one sign-in or refresh returns. */
export type TokenSet = {
  readonly accessToken: string;
  readonly idToken: string;
  /** Absent on a refresh: the refresh token in hand stays valid. */
  readonly refreshToken: string | null;
  /** Seconds until the access and ID tokens expire. */
  readonly expiresIn: number;
};

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

/** Trades the one-time code for tokens, proving this app asked for it. */
export function exchangeCode(config: AuthConfig, code: string, verifier: string, fetcher: Fetch = fetch): Promise<TokenSet> {
  return tokenRequest(config, fetcher, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: callbackUrl(config),
  });
}

/** Gets fresh access and ID tokens with the refresh token. */
export function refreshTokens(config: AuthConfig, refreshToken: string, fetcher: Fetch = fetch): Promise<TokenSet> {
  return tokenRequest(config, fetcher, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(config: AuthConfig, fetcher: Fetch, grant: Record<string, string>): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetcher(new URL("/oauth2/token", config.loginUrl).href, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, ...grant }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AuthError("unavailable", "The identity provider could not be reached");
  }
  if (response.status >= 500) {
    throw new AuthError("unavailable", `The identity provider failed with status ${response.status}`);
  }
  if (!response.ok) {
    // The body names the OAuth error. It is not shown or logged: it can echo what was sent.
    throw new AuthError("rejected", `The identity provider refused the grant with status ${response.status}`);
  }
  return parseTokenSet(await response.json().catch(() => null));
}

/** Reads a token response, and refuses one that is missing what Kin needs. */
export function parseTokenSet(body: unknown): TokenSet {
  if (typeof body !== "object" || body === null) {
    throw new AuthError("malformed_response", "The token response is not an object");
  }
  const fields = body as Record<string, unknown>;
  const { access_token: accessToken, id_token: idToken, refresh_token: refreshToken, expires_in: expiresIn, token_type: tokenType } = fields;
  if (typeof accessToken !== "string" || accessToken === "" || typeof idToken !== "string" || idToken === "") {
    throw new AuthError("malformed_response", "The token response lacks an access or ID token");
  }
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer") {
    throw new AuthError("malformed_response", "The token response is not a bearer token");
  }
  if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0) {
    throw new AuthError("malformed_response", "The token response has no valid lifetime");
  }
  if (refreshToken !== undefined && (typeof refreshToken !== "string" || refreshToken === "")) {
    throw new AuthError("malformed_response", "The token response has a malformed refresh token");
  }
  return { accessToken, idToken, refreshToken: refreshToken ?? null, expiresIn };
}
