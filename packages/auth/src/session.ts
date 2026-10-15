import type { AuthConfig } from "@kin/config";
import { JwtVerifier } from "aws-jwt-verify";
import { FetchError, JwksValidationError, JwtBaseError, NotSupportedError, ParameterValidationError } from "aws-jwt-verify/error";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";

import { ACCOUNT_TYPES, type AccountType } from "./account-types.ts";
import { AuthError } from "./auth-error.ts";
import type { Fetch } from "./oauth.ts";

/** Who is signed in, as their verified tokens say. */
export type Session = {
  /** The identity provider's stable ID for the person: the `sub` claim. */
  readonly userId: string;
  readonly email: string;
  /** Cognito confirmed the person owns the address. */
  readonly emailVerified: boolean;
  readonly name: string;
  readonly accountTypes: readonly AccountType[];
};

export type SessionTokens = { readonly accessToken: string; readonly idToken: string };

export type SessionVerifier = {
  /**
   * The session the tokens prove, or `null` when they prove none: expired,
   * forged, for another app or another person. A provider that cannot be
   * reached is an error, never a signed-out answer.
   */
  verify(tokens: SessionTokens, expected?: { readonly nonce?: string }): Promise<Session | null>;
};

/** A token that is well formed but not one Kin accepts. */
class TokenRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRejected";
  }
}

const JWKS_TIMEOUT_MS = 5_000;

/**
 * Checks Kin's session tokens against the identity provider's signing keys:
 * the signature, the issuer, the expiry, which app they were issued to and
 * what they are for. The keys are fetched once and cached.
 */
export function createSessionVerifier(config: AuthConfig, fetcher: Fetch = fetch): SessionVerifier {
  const jwksCache = new SimpleJwksCache({
    fetcher: {
      async fetch(uri: string) {
        const response = await fetcher(uri, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) }).catch(() => {
          throw new AuthError("unavailable", "The identity provider's signing keys could not be fetched");
        });
        if (!response.ok) {
          throw new AuthError("unavailable", `The identity provider's signing keys answered ${response.status}`);
        }
        return response.arrayBuffer();
      },
    },
  });
  const issuer = { issuer: config.issuer, jwksUri: config.jwksUri };
  const access = JwtVerifier.create(
    {
      ...issuer,
      // An access token from Cognito names its app in client_id, not aud.
      audience: null,
      customJwtCheck: ({ payload }) => {
        if (payload.token_use !== "access") throw new TokenRejected("Not an access token");
        if (payload.client_id !== config.clientId) throw new TokenRejected("Access token for another app");
      },
    },
    { jwksCache },
  );
  const id = JwtVerifier.create(
    {
      ...issuer,
      audience: config.clientId,
      customJwtCheck: ({ payload }) => {
        if (payload.token_use !== "id") throw new TokenRejected("Not an ID token");
      },
    },
    { jwksCache },
  );

  return {
    async verify(tokens, expected = {}) {
      try {
        const [accessClaims, idClaims] = await Promise.all([access.verify(tokens.accessToken), id.verify(tokens.idToken)]);
        if (accessClaims.sub !== idClaims.sub || typeof idClaims.sub !== "string") return null;
        if (expected.nonce !== undefined && idClaims.nonce !== expected.nonce) return null;
        const { email, name } = idClaims;
        // Cognito sends the flag as a boolean, or as the text "true" for some providers.
        const emailVerified = idClaims["email_verified"] === true || idClaims["email_verified"] === "true";
        if (typeof email !== "string" || email === "") return null;
        return {
          userId: idClaims.sub,
          email,
          emailVerified,
          name: typeof name === "string" && name.trim() !== "" ? name.trim() : email,
          accountTypes: accountTypesOf(accessClaims["cognito:groups"]),
        };
      } catch (error) {
        if (isRejectedToken(error)) return null;
        throw error;
      }
    },
  };
}

function accountTypesOf(groups: unknown): AccountType[] {
  if (!Array.isArray(groups)) return [];
  return ACCOUNT_TYPES.filter((type) => groups.includes(type));
}

// A bad token means "not signed in". A key that cannot be fetched or read, or
// a verifier set up wrongly, is a fault that must surface.
function isRejectedToken(error: unknown): boolean {
  if (error instanceof TokenRejected) return true;
  if (!(error instanceof JwtBaseError)) return false;
  return !(
    error instanceof FetchError ||
    error instanceof JwksValidationError ||
    error instanceof ParameterValidationError ||
    error instanceof NotSupportedError
  );
}
