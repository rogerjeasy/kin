import { describe, expect, it } from "vitest";

import { checkAuthorization, registerClient } from "./oauth";
import { clientResolver, isPublicAddress } from "./oauth-clients";

/**
 * Kin's authorization server (decision 111), the parts that need no database:
 * registration, who a client is (a signed registration or a client ID
 * metadata document), and where a refusal may be sent.
 */

const KEY = "a server signing key of at least thirty-two characters";
const ORIGIN = "https://kin.example";
const DOCUMENT_ID = "https://app.example/oauth/client.json";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const document = { client_id: DOCUMENT_ID, client_name: "Example MCP Client", redirect_uris: ["http://127.0.0.1:3000/callback"], token_endpoint_auth_method: "none" };

const request = (clientId: string, change: Record<string, string> = {}) =>
  new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:61000/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s", ...change });

describe("registration", () => {
  it("gives a public client a signed ID and no secret", () => {
    const reply = registerClient(KEY, { client_name: "Claude Code", redirect_uris: ["http://localhost/callback"], token_endpoint_auth_method: "client_secret_post" }, 1_800_000_000_000);
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ client_name: "Claude Code", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], client_id_issued_at: 1_800_000_000 });
    expect(reply.body["client_secret"]).toBeUndefined();
    expect(String(reply.body["client_id"])).toMatch(/^kin_cli_/u);
  });

  it("is switched off without a signing key, and refuses a redirect URI Kin will never send a code to", () => {
    expect(registerClient(null, { redirect_uris: ["http://localhost/cb"] }, 0).status).toBe(503);
    expect(registerClient(KEY, { redirect_uris: ["http://attacker.example/cb"] }, 0)).toMatchObject({ status: 400, body: { error: "invalid_redirect_uri" } });
  });
});

describe("who a client is", () => {
  it("is read from a client ID metadata document whose client_id is its own URL, once per ten minutes", async () => {
    let fetched = 0;
    const clients = clientResolver(KEY, async () => {
      fetched += 1;
      return document;
    });
    expect(await clients(DOCUMENT_ID)).toEqual({ clientId: DOCUMENT_ID, name: "Example MCP Client", redirectUris: ["http://127.0.0.1:3000/callback"], documentHost: "app.example" });
    await clients(DOCUMENT_ID);
    expect(fetched).toBe(1);
  });

  it("is unknown when the document names another client, cannot be fetched, or the URL is not one Kin fetches", async () => {
    expect(await clientResolver(KEY, async () => ({ ...document, client_id: "https://elsewhere.example/client.json" }))(DOCUMENT_ID)).toBeNull();
    expect(await clientResolver(KEY, async () => Promise.reject(new Error("unreachable")))(DOCUMENT_ID)).toBeNull();
    let fetched = false;
    const clients = clientResolver(KEY, async () => {
      fetched = true;
      return document;
    });
    expect(await clients("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(await clients("http://app.example/client.json")).toBeNull();
    expect(fetched).toBe(false);
  });

  it("is never fetched from this machine, a private network or the cloud's metadata address", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect({ address, public: isPublicAddress(address) }).toEqual({ address, public: false });
    }
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
    expect(isPublicAddress("not an address")).toBe(false);
  });
});

describe("an authorization request", () => {
  const clients = clientResolver(KEY, async () => document);
  const services = { origin: ORIGIN, clients };

  it("is put to the member when the client and its loopback redirect URI are known, on any port", async () => {
    expect(await checkAuthorization(request(DOCUMENT_ID), services)).toMatchObject({ kind: "ask", request: { clientId: DOCUMENT_ID, scope: "read", state: "s" } });
  });

  it("is refused to the person, never redirected, for an unknown client or a redirect URI it did not register", async () => {
    expect(await checkAuthorization(request("kin_cli_unknown.client"), services)).toMatchObject({ kind: "refuse" });
    expect(await checkAuthorization(request(DOCUMENT_ID, { redirect_uri: "https://attacker.example/cb" }), services)).toMatchObject({ kind: "refuse" });
  });

  it("goes back to the client with the error, the state and the issuer when only the rest is wrong", async () => {
    const check = await checkAuthorization(request(DOCUMENT_ID, { code_challenge_method: "plain" }), services);
    expect(check.kind).toBe("redirect");
    const location = new URL(check.kind === "redirect" ? check.location : "");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ error: "invalid_request", state: "s", iss: ORIGIN });
    expect(location.host).toBe("127.0.0.1:61000");
  });
});
