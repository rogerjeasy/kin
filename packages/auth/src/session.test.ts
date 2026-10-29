import type { AuthConfig } from "@kin/config";
import { describe, expect, it } from "vitest";

import { AuthError } from "./auth-error.ts";
import type { Fetch } from "./oauth.ts";
import { createSessionVerifier } from "./session.ts";
import { cognitoClaims, createTokenSigner } from "./testing/index.ts";

const config: AuthConfig = {
  issuer: "https://issuer.example/pool",
  jwksUri: "https://issuer.example/pool/.well-known/jwks.json",
  loginUrl: "https://login.example",
  clientId: "client-1",
  webOrigin: "https://kin.example",
};

const signer = createTokenSigner();
const person = { issuer: config.issuer, clientId: config.clientId, sub: "user-1", email: "elena@example.com", name: "Elena Moreau" };

function servingKeys(keys: unknown = signer.jwks): Fetch {
  return async (url) => (url === config.jwksUri ? new Response(JSON.stringify(keys)) : new Response("", { status: 404 }));
}

function tokensFor(claims = cognitoClaims(person), sign = signer.sign) {
  return { accessToken: sign(claims.access), idToken: sign(claims.id) };
}

describe("a session", () => {
  const verifier = createSessionVerifier(config, servingKeys());

  it("says whether Cognito verified the address, as a flag or as text", async () => {
    const verified = async (emailVerified: boolean | "true" | "false") => (await verifier.verify(tokensFor(cognitoClaims({ ...person, emailVerified }))))?.emailVerified;
    expect(await verified(true)).toBe(true);
    expect(await verified("true")).toBe(true);
    expect(await verified(false)).toBe(false);
    expect(await verified("false")).toBe(false);
  });

  it("is proved by a matching access and ID token from Kin's provider", async () => {
    // Tokens are checked against the real clock, so this one is issued now, to the second.
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    await expect(verifier.verify(tokensFor(cognitoClaims({ ...person, now, groups: ["family_member", "other"] })))).resolves.toEqual({
      userId: "user-1",
      email: "elena@example.com",
      emailVerified: true,
      name: "Elena Moreau",
      accountTypes: ["family_member"],
      authentication: { at: now, methods: [], tokenId: null },
    });
  });

  it("carries how the person signed in, for a step-up to judge", async () => {
    const authTime = new Date("2026-10-26T11:58:00Z");
    const tokens = tokensFor(cognitoClaims({ ...person, authTime, amr: ["pwd", "otp", "mfa"], acr: "urn:cognito:loa:4", jti: "id-token-1" }));
    await expect(verifier.verify(tokens)).resolves.toMatchObject({ authentication: { at: authTime, methods: ["pwd", "otp", "mfa"], tokenId: "id-token-1" } });
  });

  it("reads a malformed method list as no methods at all", async () => {
    const claims = cognitoClaims(person);
    const tokens = { accessToken: signer.sign(claims.access), idToken: signer.sign({ ...claims.id, amr: "mfa", auth_time: "soon" }) };
    await expect(verifier.verify(tokens)).resolves.toMatchObject({ authentication: { at: null, methods: [] } });
  });

  it("checks the nonce when the sign-in sent one", async () => {
    const tokens = tokensFor(cognitoClaims({ ...person, nonce: "n-1" }));

    await expect(verifier.verify(tokens, { nonce: "n-1" })).resolves.not.toBeNull();
    await expect(verifier.verify(tokens, { nonce: "n-2" })).resolves.toBeNull();
  });

  it("falls back to the email when the person has no name", async () => {
    await expect(verifier.verify(tokensFor(cognitoClaims({ ...person, name: " " })))).resolves.toMatchObject({ name: "elena@example.com" });
  });
});

describe("no session is proved by", () => {
  const verifier = createSessionVerifier(config, servingKeys());
  const good = cognitoClaims(person);

  it.each([
    ["an expired token", cognitoClaims({ ...person, now: new Date(Date.now() - 2 * 3600_000) })],
    ["another issuer", cognitoClaims({ ...person, issuer: "https://evil.example/pool" })],
    ["another app's tokens", cognitoClaims({ ...person, clientId: "client-2" })],
    ["an ID token used as the access token", { access: good.id, id: good.id }],
    ["an access token used as the ID token", { access: good.access, id: good.access }],
    ["tokens of two different people", { access: good.access, id: cognitoClaims({ ...person, sub: "user-2" }).id }],
    ["an ID token without an email", { access: good.access, id: { ...good.id, email: undefined } }],
  ])("%s", async (_case, claims) => {
    await expect(verifier.verify(tokensFor(claims))).resolves.toBeNull();
  });

  it("a token signed with another key", async () => {
    const forger = createTokenSigner();

    await expect(verifier.verify(tokensFor(good, forger.sign))).resolves.toBeNull();
  });

  it("a token whose payload was changed after signing", async () => {
    const tokens = tokensFor();
    const [header, , signature] = tokens.accessToken.split(".");
    const forged = Buffer.from(JSON.stringify({ ...good.access, sub: "user-2" })).toString("base64url");

    await expect(verifier.verify({ ...tokens, accessToken: `${header}.${forged}.${signature}` })).resolves.toBeNull();
  });

  it("something that is not a token at all", async () => {
    await expect(verifier.verify({ accessToken: "not-a-jwt", idToken: "x" })).resolves.toBeNull();
  });
});

describe("a provider that cannot be reached", () => {
  it("is an error that can be retried, never a quiet signed-out answer", async () => {
    const unreachable = createSessionVerifier(config, () => Promise.reject(new Error("offline")));

    await expect(unreachable.verify(tokensFor())).rejects.toBeInstanceOf(AuthError);
    await expect(unreachable.verify(tokensFor())).rejects.toMatchObject({ retryable: true });
  });
});
