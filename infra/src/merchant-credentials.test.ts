import { describe, expect, it } from "vitest";

import { readMerchantCredentials } from "./merchant-credentials.ts";

const ID = "A".repeat(80);
const SECRET = "E".repeat(80);

describe("the demo pharmacy's settings before they are stored", () => {
  it("are read under the pharmacy's own names, or the sandbox app's first ones", () => {
    expect(readMerchantCredentials({ KIN_MERCHANT_PAYPAL_CLIENT_ID: ID, KIN_MERCHANT_PAYPAL_CLIENT_SECRET: SECRET, KIN_MERCHANT_PAYPAL_VAULT_ID: "4n3625505h977864g" })).toEqual({
      ok: true,
      credentials: { clientId: ID, clientSecret: SECRET, vaultId: "4n3625505h977864g" },
    });
    expect(readMerchantCredentials({ PAYPAL_SANDBOX_MERCHANT_CLIENT_ID: ID, PAYPAL_SANDBOX_MERCHANT_CLIENT_SECRET: SECRET, KIN_MERCHANT_PAYPAL_VAULT_ID: "v1" })).toMatchObject({ ok: true, credentials: { clientId: ID } });
  });

  it("name every missing or malformed setting, and never its value", () => {
    const read = readMerchantCredentials({ PAYPAL_SANDBOX_MERCHANT_CLIENT_ID: "short", PAYPAL_SANDBOX_MERCHANT_CLIENT_SECRET: SECRET, KIN_MERCHANT_PAYPAL_VAULT_ID: "not a token" });
    expect(read.ok).toBe(false);
    const problems = read.ok ? [] : read.problems;
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/CLIENT_ID.*VAULT_ID.*vault-card/s);
    expect(problems.join(" ")).not.toMatch(/short|not a token|EEEE/);
  });
});
