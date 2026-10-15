import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

/**
 * A stand-in identity provider's signing key, for tests only. It signs tokens
 * shaped like Cognito's and publishes its public key as a JWKS.
 */
export type TokenSigner = {
  readonly jwks: { readonly keys: readonly Record<string, unknown>[] };
  sign(claims: Record<string, unknown>): string;
};

export function createTokenSigner(kid = "test-key"): TokenSigner {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    jwks: { keys: [{ ...publicJwk(publicKey), kid, alg: "RS256", use: "sig" }] },
    sign(claims) {
      const header = encode({ alg: "RS256", typ: "JWT", kid });
      const body = encode(claims);
      const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey, "base64url");
      return `${header}.${body}.${signature}`;
    },
  };
}

/** Claims for a Cognito-shaped access and ID token pair, valid for an hour from `now`. */
export function cognitoClaims(options: {
  issuer: string;
  clientId: string;
  sub: string;
  email: string;
  name: string;
  nonce?: string;
  groups?: readonly string[];
  emailVerified?: boolean | "true" | "false";
  now?: Date;
  lifetimeSeconds?: number;
}): { access: Record<string, unknown>; id: Record<string, unknown> } {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const exp = iat + (options.lifetimeSeconds ?? 3600);
  const common = { iss: options.issuer, sub: options.sub, iat, exp, auth_time: iat };
  return {
    access: { ...common, token_use: "access", client_id: options.clientId, scope: "openid email profile", "cognito:groups": options.groups ?? [] },
    id: {
      ...common,
      token_use: "id",
      aud: options.clientId,
      email: options.email,
      email_verified: options.emailVerified ?? true,
      name: options.name,
      ...(options.nonce ? { nonce: options.nonce } : {}),
    },
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function publicJwk(key: KeyObject): Record<string, unknown> {
  return key.export({ format: "jwk" }) as Record<string, unknown>;
}
