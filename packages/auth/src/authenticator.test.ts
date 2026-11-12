import { describe, expect, it } from "vitest";

import { AuthenticatorError, authenticatorUri, cognitoAuthenticator } from "./authenticator.ts";
import type { Fetch } from "./oauth.ts";
import { userPoolOf } from "./user-pool.ts";

const pool = userPoolOf("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example1");
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

type Seen = { url: string; target: string | null; body: Record<string, unknown> };

/** A user pool that answers each operation from a table, as Cognito's JSON API does. */
function userPool(answers: Record<string, { status: number; body: unknown }>) {
  const seen: Seen[] = [];
  const fetcher: Fetch = async (url, init) => {
    const headers = new Headers(init.headers);
    const target = headers.get("x-amz-target");
    seen.push({ url, target, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const operation = target?.replace("AWSCognitoIdentityProviderService.", "") ?? "";
    const answer = answers[operation] ?? { status: 400, body: { __type: "UnknownOperationException" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/x-amz-json-1.1" } });
  };
  return { seen, authenticator: cognitoAuthenticator(pool, fetcher) };
}

const reasonOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (thrown: unknown) => thrown);
  return error instanceof AuthenticatorError ? error.reason : error;
};

describe("setting up an authenticator app", () => {
  it("starts with the person's own token and returns the secret", async () => {
    const { seen, authenticator } = userPool({ AssociateSoftwareToken: { status: 200, body: { SecretCode: SECRET } } });
    await expect(authenticator.begin("access-1")).resolves.toEqual({ secret: SECRET });
    expect(seen).toEqual([{ url: "https://cognito-idp.us-east-1.amazonaws.com/", target: "AWSCognitoIdentityProviderService.AssociateSoftwareToken", body: { AccessToken: "access-1" } }]);
  });

  it("confirms with a code, then makes the app the second factor", async () => {
    const { seen, authenticator } = userPool({ VerifySoftwareToken: { status: 200, body: { Status: "SUCCESS" } }, SetUserMFAPreference: { status: 200, body: {} } });
    await authenticator.confirm("access-1", "123456");
    expect(seen.map((call) => call.body)).toEqual([
      { AccessToken: "access-1", UserCode: "123456", FriendlyDeviceName: "Kin" },
      { AccessToken: "access-1", SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } },
    ]);
  });

  it("never sets the preference when the code is wrong", async () => {
    const { seen, authenticator } = userPool({ VerifySoftwareToken: { status: 400, body: { __type: "EnableSoftwareTokenMFAException", message: "Code mismatch" } } });
    expect(await reasonOf(authenticator.confirm("access-1", "123456"))).toBe("wrong_code");
    expect(seen).toHaveLength(1);
    const { seen: none, authenticator: unchecked } = userPool({});
    expect(await reasonOf(unchecked.confirm("access-1", "12345a"))).toBe("wrong_code");
    expect(none).toHaveLength(0);
  });

  it("asks for a fresh sign-in when the token lacks the scope or has expired", async () => {
    const { authenticator } = userPool({ AssociateSoftwareToken: { status: 400, body: { __type: "NotAuthorizedException", message: "Access Token does not have required scopes" } } });
    expect(await reasonOf(authenticator.begin("access-1"))).toBe("sign_in_again");
  });

  it("tells waiting from failing, and refuses a secret it cannot use", async () => {
    expect(await reasonOf(userPool({ AssociateSoftwareToken: { status: 400, body: { __type: "com.amazonaws#LimitExceededException" } } }).authenticator.begin("a"))).toBe("too_many_tries");
    expect(await reasonOf(userPool({ AssociateSoftwareToken: { status: 503, body: {} } }).authenticator.begin("a"))).toBe("unavailable");
    expect(await reasonOf(userPool({ AssociateSoftwareToken: { status: 200, body: { SecretCode: "<script>" } } }).authenticator.begin("a"))).toBe("refused");
    const unreachable = cognitoAuthenticator(pool, () => Promise.reject(new Error("offline")));
    expect(await reasonOf(unreachable.begin("a"))).toBe("unavailable");
  });

  it("puts Kin's name, the account and the secret in the app's address", () => {
    expect(authenticatorUri("sam@example.com", SECRET)).toBe(`otpauth://totp/Kin%3Asam%40example.com?secret=${SECRET}&issuer=Kin`);
  });
});
