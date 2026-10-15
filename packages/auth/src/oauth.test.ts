import type { AuthConfig } from "@kin/config";
import { describe, expect, it } from "vitest";

import { AuthError } from "./auth-error.ts";
import { authorizeUrl, exchangeCode, logoutUrl, parseAuthScreen, parseTokenSet, refreshTokens, type Fetch } from "./oauth.ts";
import { createSignInSecrets, pkceChallenge } from "./pkce.ts";

const config: AuthConfig = {
  issuer: "https://issuer.example/pool",
  jwksUri: "https://issuer.example/pool/.well-known/jwks.json",
  loginUrl: "https://login.example",
  clientId: "client-1",
  webOrigin: "https://kin.example",
};

const secrets = { verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: "state-1", nonce: "nonce-1" };

describe("PKCE", () => {
  it("derives the S256 challenge of RFC 7636's own example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("draws three distinct secrets of 256 bits each for every sign-in", () => {
    const first = createSignInSecrets();
    const second = createSignInSecrets();

    expect(new Set([first.verifier, first.state, first.nonce, second.verifier]).size).toBe(4);
    expect(Buffer.from(first.verifier, "base64url")).toHaveLength(32);
  });
});

describe("the sign-in address", () => {
  it("asks for a code with PKCE, state and nonce, coming back to Kin's callback", () => {
    const url = new URL(authorizeUrl(config, secrets, "fr", "sign-in"));

    expect(url.origin + url.pathname).toBe("https://login.example/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://kin.example/auth/callback",
      scope: "openid email profile",
      state: "state-1",
      nonce: "nonce-1",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      lang: "fr",
    });
  });

  it("opens the sign-up page with the same secrets when a person is new", () => {
    const signIn = new URL(authorizeUrl(config, secrets, "de", "sign-in"));
    const signUp = new URL(authorizeUrl(config, secrets, "de", "sign-up"));

    expect(signUp.origin + signUp.pathname).toBe("https://login.example/signup");
    expect(Object.fromEntries(signUp.searchParams)).toEqual(Object.fromEntries(signIn.searchParams));
  });

  it("starts on the sign-in page unless sign-up is asked for by name", () => {
    expect(parseAuthScreen("sign-up")).toBe("sign-up");
    for (const value of [null, "", "sign-in", "SIGN-UP", "/signup"]) expect(parseAuthScreen(value)).toBe("sign-in");
  });

  it("never sends the verifier itself", () => {
    expect(authorizeUrl(config, secrets, "en", "sign-in")).not.toContain(secrets.verifier);
  });

  it("leaves the language to the provider when its pages do not speak the reader's", () => {
    expect(new URL(authorizeUrl(config, secrets, "ar", "sign-in")).searchParams.has("lang")).toBe(false);
  });

  it("signs out of the provider too, then comes back to Kin's home page", () => {
    expect(logoutUrl(config)).toBe("https://login.example/logout?client_id=client-1&logout_uri=https%3A%2F%2Fkin.example%2F");
  });
});

const tokenBody = { access_token: "a", id_token: "i", refresh_token: "r", expires_in: 3600, token_type: "Bearer" };

function answering(status: number, body: unknown, seen: { url?: string; body?: string } = {}): Fetch {
  return async (url, init) => {
    seen.url = url;
    seen.body = String(init.body);
    return new Response(JSON.stringify(body), { status });
  };
}

describe("the token exchange", () => {
  it("trades the code and the verifier for tokens", async () => {
    const seen: { url?: string; body?: string } = {};

    const tokens = await exchangeCode(config, "code-1", secrets.verifier, answering(200, tokenBody, seen));

    expect(tokens).toEqual({ accessToken: "a", idToken: "i", refreshToken: "r", expiresIn: 3600 });
    expect(seen.url).toBe("https://login.example/oauth2/token");
    expect(Object.fromEntries(new URLSearchParams(seen.body))).toEqual({
      client_id: "client-1",
      grant_type: "authorization_code",
      code: "code-1",
      code_verifier: secrets.verifier,
      redirect_uri: "https://kin.example/auth/callback",
    });
  });

  it("keeps the refresh token in hand when a refresh returns none", async () => {
    const withoutRefresh = { ...tokenBody, refresh_token: undefined };

    expect((await refreshTokens(config, "r", answering(200, withoutRefresh))).refreshToken).toBeNull();
  });

  it("says a refused grant cannot be retried, and a failing provider can", async () => {
    await expect(exchangeCode(config, "c", "v", answering(400, { error: "invalid_grant" }))).rejects.toMatchObject({ reason: "rejected", retryable: false });
    await expect(exchangeCode(config, "c", "v", answering(503, {}))).rejects.toMatchObject({ reason: "unavailable", retryable: true });
    await expect(exchangeCode(config, "c", "v", () => Promise.reject(new Error("offline")))).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("a token response", () => {
  it.each([
    ["no access token", { ...tokenBody, access_token: undefined }],
    ["an empty ID token", { ...tokenBody, id_token: "" }],
    ["no lifetime", { ...tokenBody, expires_in: undefined }],
    ["a fractional lifetime", { ...tokenBody, expires_in: 1.5 }],
    ["another token type", { ...tokenBody, token_type: "mac" }],
    ["a malformed refresh token", { ...tokenBody, refresh_token: 7 }],
    ["not an object", "tokens"],
  ])("is refused with %s", (_case, body) => {
    expect(() => parseTokenSet(body)).toThrow(AuthError);
  });
});
