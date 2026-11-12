import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readDemoMerchantConfig, readMerchantServiceConfig } from "./demo-merchant-config.ts";

const SECRET = "s".repeat(40);
const PAYPAL = { KIN_MERCHANT_PAYPAL_CLIENT_ID: "client", KIN_MERCHANT_PAYPAL_CLIENT_SECRET: "client-secret", KIN_MERCHANT_PAYPAL_VAULT_ID: "8kk91234AB" };

describe("the worker's demo pharmacy settings", () => {
  it("are off with no address, so the seller stays simulated in process", () => {
    expect(readDemoMerchantConfig({})).toBeNull();
    expect(readDemoMerchantConfig({ KIN_DEMO_MERCHANT_URL: " ", KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET })).toBeNull();
  });

  it("carry the address without a trailing slash and the signing secret", () => {
    expect(readDemoMerchantConfig({ KIN_DEMO_MERCHANT_URL: "https://pharmacy.example.com/", KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET })).toEqual({ url: "https://pharmacy.example.com", signingSecret: SECRET });
    expect(readDemoMerchantConfig({ KIN_DEMO_MERCHANT_URL: "http://localhost:4100", KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET })).toMatchObject({ url: "http://localhost:4100" });
  });

  it("refuse a pharmacy with no signing secret, or one too short to be safe", () => {
    expect(() => readDemoMerchantConfig({ KIN_DEMO_MERCHANT_URL: "http://localhost:4100" })).toThrow(ConfigError);
    expect(() => readDemoMerchantConfig({ KIN_DEMO_MERCHANT_URL: "http://localhost:4100", KIN_DEMO_MERCHANT_SIGNING_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("refuse plain http to another machine, and an address with a path", () => {
    for (const url of ["http://pharmacy.example.com", "https://pharmacy.example.com/orders", "ftp://pharmacy", "https://user@pharmacy.example.com"]) {
      expect(() => readDemoMerchantConfig({ KIN_DEMO_MERCHANT_URL: url, KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET }), url).toThrow(ConfigError);
    }
  });
});

describe("the pharmacy's own settings", () => {
  it("will not start without the signing secret, so no order goes unsigned", () => {
    expect(() => readMerchantServiceConfig({})).toThrow(ConfigError);
    expect(() => readMerchantServiceConfig({ ...PAYPAL })).toThrow(ConfigError);
  });

  it("charge nothing, and say so, with no PayPal setting", () => {
    expect(readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET })).toEqual({ signingSecret: SECRET, wallet: { kind: "simulated" }, chargesPerDay: 20 });
  });

  it("charge the saved payment method through PayPal's sandbox with all three set", () => {
    expect(readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET, KIN_MERCHANT_CHARGES_PER_DAY: "5", ...PAYPAL })).toEqual({
      signingSecret: SECRET,
      chargesPerDay: 5,
      wallet: { kind: "paypal_sandbox", baseUrl: "https://api-m.sandbox.paypal.com", clientId: "client", clientSecret: "client-secret", vaultId: "8kk91234AB" },
    });
  });

  it("refuse half the PayPal settings, a payment token that is not one, and live PayPal", () => {
    expect(() => readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET, KIN_MERCHANT_PAYPAL_CLIENT_ID: "client" })).toThrow(/KIN_MERCHANT_PAYPAL_CLIENT_SECRET, KIN_MERCHANT_PAYPAL_VAULT_ID/);
    expect(() => readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET, ...PAYPAL, KIN_MERCHANT_PAYPAL_VAULT_ID: "not a token" })).toThrow(ConfigError);
    expect(() => readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET, ...PAYPAL, KIN_MERCHANT_PAYPAL_URL: "https://api-m.paypal.com" })).toThrow(/sandbox/);
    expect(readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET, ...PAYPAL, KIN_MERCHANT_PAYPAL_URL: "http://localhost:9000" }).wallet).toMatchObject({ baseUrl: "http://localhost:9000" });
  });

  it("refuse a daily charge limit that is not a whole number from 1 to 1000", () => {
    for (const bad of ["0", "-1", "2.5", "ten", "1001"]) {
      expect(() => readMerchantServiceConfig({ KIN_DEMO_MERCHANT_SIGNING_SECRET: SECRET, KIN_MERCHANT_CHARGES_PER_DAY: bad }), bad).toThrow(/1 to 1000/);
    }
  });
});
