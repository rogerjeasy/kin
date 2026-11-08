import { describe, expect, it } from "vitest";

import { InfraConfigError, readConfig } from "./config.ts";

const context: Record<string, unknown> = {
  "kin:region": "us-east-1",
  "kin:monthlyBudgetUsd": 150,
  "kin:databaseCapacityAcu": { min: 0, max: 4 },
  "kin:webOrigins": ["http://localhost:3000"],
  "kin:githubDeploySubject": "repo:owner@1/kin@2:ref:refs/heads/main",
  "kin:neighbourPrincipalPatterns": ["role/wick-*"],
  "kin:neighbourProjects": ["wick"],
};

const env = { CDK_DEFAULT_ACCOUNT: "123456789012", KIN_ALERT_EMAIL: "a@example.com" };

function read(
  overrides: Record<string, unknown> = {},
  environment: Record<string, string | undefined> = env,
) {
  return readConfig({
    context: (key) => ({ ...context, ...overrides })[key],
    env: environment,
  });
}

describe("readConfig", () => {
  it("reads cdk.json and the environment into typed settings", () => {
    expect(read()).toMatchObject({
      account: "123456789012",
      availabilityZones: ["us-east-1a", "us-east-1b"],
      alertEmail: "a@example.com",
      databaseCapacityAcu: { min: 0, max: 4 },
    });
  });

  it("prefers an alert email passed as context", () => {
    expect(read({ "kin:alertEmail": "b@example.com" }).alertEmail).toBe("b@example.com");
  });

  it("leaves sign-in email to Cognito unless an SES sender is set", () => {
    expect(read().senderEmail).toBeNull();
    expect(read({}, { ...env, KIN_SENDER_EMAIL: "" }).senderEmail).toBeNull();
    expect(read({}, { ...env, KIN_SENDER_EMAIL: "kin@example.com" }).senderEmail).toBe("kin@example.com");
    expect(read({ "kin:senderEmail": "c@example.com" }).senderEmail).toBe("c@example.com");
  });

  it("leaves top-ups off until the pool's PayPal app is configured", () => {
    expect(read().paypal).toBeNull();
    expect(read({ "kin:paypal": { clientId: "client", webhookId: "WH-1" } }).paypal).toEqual({ clientId: "client", webhookId: "WH-1" });
    // Top-ups without the worker's webhook would take money nobody records.
    expect(() => read({ "kin:paypal": { clientId: "client", webhookId: null } })).toThrow(InfraConfigError);
    expect(() => read({ "kin:paypal": { clientId: "client" } })).toThrow(InfraConfigError);
    expect(() => read({ "kin:paypal": { clientId: "" } })).toThrow(InfraConfigError);
    expect(() => read({ "kin:paypal": "client" })).toThrow(InfraConfigError);
  });

  it("leaves speech off unless switched on, and refuses anything but true or false", () => {
    expect(read().speech).toBe(false);
    expect(read({ "kin:speech": true }).speech).toBe(true);
    expect(() => read({ "kin:speech": "yes" })).toThrow(InfraConfigError);
  });

  it("leaves Claude off unless switched on, and refuses anything but true or false", () => {
    expect(read().claude).toBe(false);
    expect(read({ "kin:claude": true }).claude).toBe(true);
    expect(() => read({ "kin:claude": "on" })).toThrow(InfraConfigError);
  });

  it("keeps demo payouts simulated unless Kin's sandbox account is named, and only with the pool's PayPal app", () => {
    const paypal = { clientId: "client", webhookId: "WH-1" };
    expect(read({ "kin:paypal": paypal }).demoSandboxPayeeEmail).toBeNull();
    expect(read({ "kin:paypal": paypal, "kin:demoSandboxPayeeEmail": "sb-kin@personal.example.com" }).demoSandboxPayeeEmail).toBe("sb-kin@personal.example.com");
    expect(() => read({ "kin:paypal": paypal, "kin:demoSandboxPayeeEmail": "kin" })).toThrow(InfraConfigError);
    // Nobody would pay them: the worker runs only with the PayPal app.
    expect(() => read({ "kin:demoSandboxPayeeEmail": "sb-kin@personal.example.com" })).toThrow(InfraConfigError);
  });

  it("refuses a sender that is not an email address", () => {
    expect(() => read({}, { ...env, KIN_SENDER_EMAIL: "kin" })).toThrow(InfraConfigError);
  });

  it("stops without an AWS account or an alert email", () => {
    expect(() => read({}, { KIN_ALERT_EMAIL: "a@example.com" })).toThrow(InfraConfigError);
    expect(() => read({}, { CDK_DEFAULT_ACCOUNT: "123456789012" })).toThrow(InfraConfigError);
  });

  it("refuses database capacity Aurora cannot run", () => {
    for (const capacity of [
      { min: 0, max: 0 },
      { min: 2, max: 1 },
      { min: 0.25, max: 4 },
      { min: 0, max: 512 },
      null,
    ]) {
      expect(() => read({ "kin:databaseCapacityAcu": capacity })).toThrow(InfraConfigError);
    }
  });

  it("refuses an empty list of neighbours", () => {
    expect(() => read({ "kin:neighbourPrincipalPatterns": [] })).toThrow(InfraConfigError);
  });
});
