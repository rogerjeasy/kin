import { ConfigError } from "./config-error.ts";

/** Where people sign in, and who Kin trusts to say who they are. */
export type AuthConfig = {
  /** The token issuer, such as https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc. */
  readonly issuer: string;
  /** The issuer's signing keys. */
  readonly jwksUri: string;
  /** The base of the sign-in pages: authorize, token and logout live under it. */
  readonly loginUrl: string;
  /** The public app client. It has no secret, so sign-in uses PKCE. */
  readonly clientId: string;
  /** The web app's own origin, which the identity provider redirects back to. */
  readonly webOrigin: string;
};

/** The environment variables an `AuthConfig` is read from. */
export const AUTH_ENV = {
  issuer: "KIN_AUTH_ISSUER",
  loginUrl: "KIN_AUTH_LOGIN_URL",
  clientId: "KIN_AUTH_CLIENT_ID",
  webOrigin: "KIN_WEB_ORIGIN",
} as const;

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Reads the sign-in settings and refuses any that are missing or unsafe.
 * Plain http is allowed only for a machine's own address, where a developer
 * or a test runs its own provider. Everything else must be https.
 */
export function readAuthConfig(env: Env): AuthConfig {
  const issuer = origin(env, AUTH_ENV.issuer, { path: true });
  return {
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    loginUrl: origin(env, AUTH_ENV.loginUrl, { path: false }),
    clientId: required(env, AUTH_ENV.clientId),
    webOrigin: origin(env, AUTH_ENV.webOrigin, { path: false }),
  };
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`${name} is not set`);
  }
  return value;
}

function origin(env: Env, name: string, { path }: { path: boolean }): string {
  const raw = required(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} is not a URL`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new ConfigError(`${name} must use https`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new ConfigError(`${name} must not carry a query, fragment or credentials`);
  }
  if (!path && url.pathname !== "/") {
    throw new ConfigError(`${name} must be an origin, without a path`);
  }
  return path ? `${url.origin}${url.pathname.replace(/\/$/, "")}` : url.origin;
}
