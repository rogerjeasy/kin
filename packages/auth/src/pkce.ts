import { createHash, randomBytes } from "node:crypto";

/** Draws `size` random bytes. Tests pass their own to stay deterministic. */
export type RandomBytes = (size: number) => Buffer;

const SECRET_BYTES = 32;

/** The S256 challenge for a PKCE verifier (RFC 7636 section 4.2). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * The three single-use secrets of one sign-in: the PKCE verifier, the state
 * that ties the answer to this browser, and the nonce that ties the ID token
 * to this request.
 */
export type SignInSecrets = { readonly verifier: string; readonly state: string; readonly nonce: string };

export function createSignInSecrets(random: RandomBytes = randomBytes): SignInSecrets {
  return {
    verifier: random(SECRET_BYTES).toString("base64url"),
    state: random(SECRET_BYTES).toString("base64url"),
    nonce: random(SECRET_BYTES).toString("base64url"),
  };
}
