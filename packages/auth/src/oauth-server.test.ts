import { describe, expect, it } from "vitest";

import {
  authorizationResponse,
  cleanClientName,
  clientOfRequest,
  clientRegistrationKey,
  grantedScope,
  parseAuthorizationRequest,
  parseClientIdUrl,
  parseClientMetadata,
  parseRedirectUri,
  parseTokenRequest,
  readClientRegistration,
  redirectUriAllowed,
  requestedScope,
  resourceMatches,
  signClientRegistration,
} from "./oauth-server.ts";

const RESOURCE = "https://kin.example/api/mcp";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const params = (entries: Record<string, string | string[]>) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(entries)) for (const each of Array.isArray(value) ? value : [value]) search.append(name, each);
  return search;
};
const trusted = { clientId: "kin_cli_x.y", redirectUri: "http://127.0.0.1:4000/cb" };
const valid = { response_type: "code", client_id: trusted.clientId, redirect_uri: trusted.redirectUri, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s-1", resource: RESOURCE };

describe("redirect URIs", () => {
  it.each(["https://claude.ai/api/mcp/auth_callback", "http://localhost:33418/callback", "http://127.0.0.1/cb", "http://[::1]:8080/cb", "https://app.example/cb?x=1"])("accepts %s", (uri) => {
    expect(parseRedirectUri(uri)).not.toBeNull();
  });

  it.each([
    ["plain http to a host", "http://evil.example/cb"],
    ["a fragment", "https://app.example/cb#x"],
    ["credentials", "https://user:pass@app.example/cb"],
    ["a custom scheme", "cursor://anysphere/cb"],
    ["javascript", "javascript:alert(1)"],
    ["a data URI", "data:text/html,hi"],
    ["a space", "https://app.example/c b"],
    ["a backslash", "https://app.example\\@evil.example/"],
    ["a look-alike loopback", "http://localhost.evil.example/cb"],
    ["something too long", `https://app.example/${"a".repeat(600)}`],
  ])("refuses %s", (_case, uri) => {
    expect(parseRedirectUri(uri)).toBeNull();
  });

  it("matches exactly, except that a loopback URI may name any port", () => {
    const registered = ["http://127.0.0.1/callback", "https://app.example/cb"];
    expect(redirectUriAllowed(registered, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectUriAllowed(registered, "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectUriAllowed(registered, "http://localhost:51234/callback")).toBe(false);
    expect(redirectUriAllowed(registered, "https://app.example/cb")).toBe(true);
    expect(redirectUriAllowed(registered, "https://app.example/cb/")).toBe(false);
    expect(redirectUriAllowed(registered, "https://app.example:8443/cb")).toBe(false);
    expect(redirectUriAllowed(registered, "https://app.example/cb?next=evil")).toBe(false);
  });
});

describe("scopes", () => {
  it("reads kin:read and kin:propose, quietly drops what Kin never grants, and refuses anything else, an approve-shaped scope included", () => {
    expect(requestedScope(null)).toBe("read");
    expect(requestedScope("kin:read")).toBe("read");
    expect(requestedScope("kin:read kin:propose offline_access")).toBe("propose");
    expect(requestedScope("kin:approve")).toBeNull();
    expect(requestedScope("kin:read admin")).toBeNull();
    expect(grantedScope("read")).toBe("kin:read");
    expect(grantedScope("propose")).toBe("kin:read kin:propose");
  });
});

describe("an authorization request", () => {
  it("is read once its client and redirect URI are trusted", () => {
    expect(clientOfRequest(params(valid))).toEqual({ ok: true, ...trusted });
    expect(parseAuthorizationRequest(params(valid), trusted, RESOURCE)).toEqual({ ok: true, request: { ...trusted, state: "s-1", codeChallenge: CHALLENGE, scope: "read" } });
  });

  it.each([
    ["no PKCE", { code_challenge: undefined }, "invalid_request"],
    ["PKCE plain, a downgrade", { code_challenge_method: "plain" }, "invalid_request"],
    ["PKCE with no method", { code_challenge_method: undefined }, "invalid_request"],
    ["a short challenge", { code_challenge: "short" }, "invalid_request"],
    ["the token response type", { response_type: "token" }, "unsupported_response_type"],
    ["an approve scope", { scope: "kin:approve" }, "invalid_scope"],
    ["another resource", { resource: "https://elsewhere.example/mcp" }, "invalid_target"],
    ["a state with a newline", { state: "a\nb" }, "invalid_request"],
  ])("refuses %s", (_case, change, error) => {
    const entries = Object.fromEntries(Object.entries({ ...valid, ...change }).filter(([, value]) => value !== undefined)) as Record<string, string>;
    expect(parseAuthorizationRequest(params(entries), trusted, RESOURCE)).toMatchObject({ ok: false, error });
  });

  it("refuses a parameter sent twice, as OAuth requires", () => {
    expect(clientOfRequest(params({ ...valid, client_id: ["a", "b"] }))).toMatchObject({ ok: false });
    expect(parseAuthorizationRequest(params({ ...valid, code_challenge: [CHALLENGE, CHALLENGE] }), trusted, RESOURCE)).toMatchObject({ ok: false, error: "invalid_request" });
  });

  it("accepts the resource in any case of scheme and host, with or without a trailing slash, and none at all", () => {
    expect(resourceMatches("HTTPS://KIN.EXAMPLE/api/mcp/", RESOURCE)).toBe(true);
    expect(resourceMatches(null, RESOURCE)).toBe(true);
    expect(resourceMatches("https://kin.example/api/mcp#x", RESOURCE)).toBe(false);
    expect(resourceMatches("https://kin.example/api", RESOURCE)).toBe(false);
  });

  it("answers at the redirect URI with the code, the state and the issuer, added as parameters so nothing in them can change the address", () => {
    const answer = new URL(authorizationResponse("https://app.example/cb?keep=1", "https://kin.example", { code: "kin_code_x" }, "a&b=c#d"));
    expect(answer.origin + answer.pathname).toBe("https://app.example/cb");
    expect(Object.fromEntries(answer.searchParams)).toEqual({ keep: "1", code: "kin_code_x", state: "a&b=c#d", iss: "https://kin.example" });
    expect(answer.hash).toBe("");
  });
});

describe("client registrations", () => {
  const key = clientRegistrationKey("a server signing key of at least thirty-two characters");

  it("are carried in a signed client ID that cannot be altered or forged", () => {
    const clientId = signClientRegistration(key, { name: "Claude Code", redirectUris: ["http://localhost/callback"], issuedAt: 1_800_000_000 });
    expect(readClientRegistration(key, clientId)).toEqual({ name: "Claude Code", redirectUris: ["http://localhost/callback"], issuedAt: 1_800_000_000 });
    const [payload, mac] = clientId.slice("kin_cli_".length).split(".");
    const forged = Buffer.from(JSON.stringify({ n: "Claude Code", r: ["https://evil.example/cb"], t: 1 })).toString("base64url");
    expect(readClientRegistration(key, `kin_cli_${forged}.${mac ?? ""}`)).toBeNull();
    expect(readClientRegistration(clientRegistrationKey("another server's signing key, also long enough"), clientId)).toBeNull();
    expect(readClientRegistration(key, `kin_cli_${payload ?? ""}`)).toBeNull();
  });

  it("refuse metadata Kin cannot honour, and answer a request for a secret with none", () => {
    expect(parseClientMetadata({ redirect_uris: [] }, "registration")).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseClientMetadata({ redirect_uris: ["http://evil.example/cb"] }, "registration")).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseClientMetadata({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }, "registration")).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(parseClientMetadata({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" }, "registration")).toMatchObject({ ok: true });
    expect(parseClientMetadata({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "private_key_jwt" }, "document")).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });

  it("keep a client's name only as safe text of up to sixty characters", () => {
    expect(cleanClientName("<script>Claude</script>\n")).toBe("script Claude /script");
    expect(cleanClientName("   ")).toBeNull();
    expect(cleanClientName("x".repeat(80))).toHaveLength(60);
  });
});

describe("a client ID metadata document's URL", () => {
  it.each(["https://claude.ai/oauth/claude-code-client-metadata", "https://app.example/client.json"])("is accepted at %s", (url) => {
    expect(parseClientIdUrl(url)).not.toBeNull();
  });

  it.each([
    ["no path", "https://app.example/"],
    ["plain http", "http://app.example/client.json"],
    ["an address, not a name", "https://169.254.169.254/latest"],
    ["an IPv6 address", "https://[::1]/client.json"],
    ["localhost", "https://localhost/client.json"],
    ["a port", "https://app.example:8443/client.json"],
    ["a query", "https://app.example/client.json?x=1"],
    ["dot segments", "https://app.example/a/../client.json"],
    ["credentials", "https://u:p@app.example/client.json"],
  ])("is refused with %s", (_case, url) => {
    expect(parseClientIdUrl(url)).toBeNull();
  });
});

describe("a token request", () => {
  const code = `kin_code_${"a".repeat(43)}`;
  const verifier = "v".repeat(43);
  const form = { grant_type: "authorization_code", code, redirect_uri: trusted.redirectUri, client_id: trusted.clientId, code_verifier: verifier };

  it("reads the authorization code grant of a public client", () => {
    expect(parseTokenRequest(params(form), null)).toEqual({ ok: true, request: { code, redirectUri: trusted.redirectUri, clientId: trusted.clientId, codeVerifier: verifier, resource: null } });
    const basic = `Basic ${Buffer.from(`${encodeURIComponent(trusted.clientId)}:`).toString("base64")}`;
    const withoutId = Object.fromEntries(Object.entries(form).filter(([name]) => name !== "client_id"));
    expect(parseTokenRequest(params(withoutId), basic)).toMatchObject({ ok: true, request: { clientId: trusted.clientId } });
  });

  it.each([
    ["a refresh grant", { grant_type: "refresh_token" }, "unsupported_grant_type"],
    ["no verifier, a PKCE downgrade", { code_verifier: undefined }, "invalid_grant"],
    ["a short verifier", { code_verifier: "short" }, "invalid_grant"],
    ["a client secret", { client_secret: "s" }, "invalid_client"],
    ["no client", { client_id: undefined }, "invalid_client"],
    ["a malformed code", { code: "abc" }, "invalid_grant"],
  ])("refuses %s", (_case, change, error) => {
    const entries = Object.fromEntries(Object.entries({ ...form, ...change }).filter(([, value]) => value !== undefined)) as Record<string, string>;
    expect(parseTokenRequest(params(entries), null)).toMatchObject({ ok: false, error });
  });

  it("refuses a code sent twice in one request", () => {
    expect(parseTokenRequest(params({ ...form, code: [code, code] }), null)).toMatchObject({ ok: false, error: "invalid_request" });
  });
});
