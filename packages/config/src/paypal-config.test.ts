import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { PAYPAL_SANDBOX_API, readPayPalConfig } from "./paypal-config.ts";

const app = { KIN_PAYPAL_CLIENT_ID: "client-id", KIN_PAYPAL_CLIENT_SECRET: "secret" };

describe("the pool's PayPal settings", () => {
  it("leave PayPal off when no client ID is set", () => {
    expect(readPayPalConfig({}, { webhook: false })).toEqual({ enabled: false });
    expect(readPayPalConfig({ KIN_PAYPAL_CLIENT_ID: "  " }, { webhook: true })).toEqual({ enabled: false });
  });

  it("talk to PayPal's sandbox by default", () => {
    expect(readPayPalConfig(app, { webhook: false })).toEqual({ enabled: true, apiUrl: PAYPAL_SANDBOX_API, clientId: "client-id", clientSecret: "secret", webhookId: null });
  });

  it("refuse any API but the sandbox or a stand-in on this machine, so nothing points Kin at live money", () => {
    expect(() => readPayPalConfig({ ...app, KIN_PAYPAL_API_URL: "https://api-m.paypal.com" }, { webhook: false })).toThrow(ConfigError);
    expect(() => readPayPalConfig({ ...app, KIN_PAYPAL_API_URL: "http://localhost.evil.example" }, { webhook: false })).toThrow(ConfigError);
    expect(readPayPalConfig({ ...app, KIN_PAYPAL_API_URL: "http://127.0.0.1:4010" }, { webhook: false })).toMatchObject({ apiUrl: "http://127.0.0.1:4010" });
  });

  it("refuse to start without the secret, or without the webhook ID where it is needed", () => {
    expect(() => readPayPalConfig({ KIN_PAYPAL_CLIENT_ID: "client-id" }, { webhook: false })).toThrow(/KIN_PAYPAL_CLIENT_SECRET/);
    expect(() => readPayPalConfig(app, { webhook: true })).toThrow(/KIN_PAYPAL_WEBHOOK_ID/);
    expect(readPayPalConfig({ ...app, KIN_PAYPAL_WEBHOOK_ID: "WH-1" }, { webhook: true })).toMatchObject({ webhookId: "WH-1" });
  });
});
