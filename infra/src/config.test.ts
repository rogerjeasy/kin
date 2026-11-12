import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { InfraConfigError, presenceTextSettings, readConfig, shiftCallSettings } from "./config.ts";

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

  it("reads AG Studio's licence key from the environment only, and an empty secret as unset", () => {
    expect(read().agStudioLicense).toBeNull();
    expect(read({}, { ...env, KIN_AG_STUDIO_LICENSE: "" }).agStudioLicense).toBeNull();
    expect(read({ "kin:agStudioLicense": "from-cdk-json" }).agStudioLicense).toBeNull();
    expect(read({}, { ...env, KIN_AG_STUDIO_LICENSE: " [v3]_[0102]_key \n" }).agStudioLicense).toBe("[v3]_[0102]_key");
    expect(() => read({}, { ...env, KIN_AG_STUDIO_LICENSE: "two words" })).toThrow(InfraConfigError);
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

  it("keeps demo invoices simulated unless Kin's sandbox personal account is named, and only with the pool's PayPal app", () => {
    const paypal = { clientId: "client", webhookId: "WH-1" };
    expect(read({ "kin:paypal": paypal }).demoInvoiceRecipientEmail).toBeNull();
    expect(read({ "kin:paypal": paypal, "kin:demoInvoiceRecipientEmail": "sb-member@personal.example.com" }).demoInvoiceRecipientEmail).toBe("sb-member@personal.example.com");
    // The web app accepts only PayPal's sandbox personal domain, so the deploy refuses anything else before it starts.
    for (const bad of ["kin", "member@example.com", "member@personal.example.com.evil.test", 42]) {
      expect(() => read({ "kin:paypal": paypal, "kin:demoInvoiceRecipientEmail": bad }), String(bad)).toThrow(InfraConfigError);
    }
    expect(() => read({ "kin:demoInvoiceRecipientEmail": "sb-member@personal.example.com" })).toThrow(InfraConfigError);
  });

  it("reads the checked-in cdk.json, which pays demo payouts and sends demo invoices to Kin's own sandbox personal accounts", () => {
    const checkedIn = JSON.parse(readFileSync(new URL("../cdk.json", import.meta.url), "utf8")) as { context: Record<string, unknown> };
    const deployed = readConfig({ context: (key) => checkedIn.context[key], env });
    expect(deployed.demoSandboxPayeeEmail).toMatch(/@personal\.example\.com$/);
    expect(deployed.demoInvoiceRecipientEmail).toMatch(/@personal\.example\.com$/);
  });

  it("leaves the demo pharmacy off unless switched on, and only beside the worker that buys from it", () => {
    const paypal = { clientId: "client", webhookId: "WH-1" };
    expect(read({ "kin:paypal": paypal }).demoMerchant).toBe(false);
    expect(read({ "kin:paypal": paypal, "kin:demoMerchant": true }).demoMerchant).toBe(true);
    expect(() => read({ "kin:paypal": paypal, "kin:demoMerchant": "yes" })).toThrow(InfraConfigError);
    expect(() => read({ "kin:demoMerchant": true })).toThrow(/needs kin:paypal/);
  });

  it("leaves the phone service off, with no address and no numbers, unless switched on", () => {
    expect(read()).toMatchObject({ voice: false, voicePublicUrl: null, twilioCallerNumber: null, twilioSmsFrom: null });
    expect(read({ "kin:voice": true }).voice).toBe(true);
    expect(() => read({ "kin:voice": "yes" })).toThrow(InfraConfigError);
  });

  it("takes the voice service's address only with the service, as an https address with no path or trailing slash", () => {
    const url = "https://abc123.us-east-1.awsapprunner.com";
    expect(read({ "kin:voice": true, "kin:voicePublicUrl": url }).voicePublicUrl).toBe(url);
    expect(() => read({ "kin:voicePublicUrl": url })).toThrow(InfraConfigError);
    for (const bad of ["http://abc.example.com", "https://abc.example.com/", "https://abc.example.com/voice", "abc.example.com", "https://a_b.example.com", 7]) {
      expect(() => read({ "kin:voice": true, "kin:voicePublicUrl": bad })).toThrow(InfraConfigError);
    }
    expect(read({ "kin:voice": true, "kin:voicePublicUrl": "" }).voicePublicUrl).toBeNull();
  });

  it("takes Kin's Twilio number from cdk.json or the environment, as E.164, only with the PayPal app and the voice service", () => {
    const paypal = { clientId: "client", webhookId: "WH-1" };
    const on = { "kin:paypal": paypal, "kin:voice": true };
    expect(read(on).twilioCallerNumber).toBeNull();
    expect(read(on, { ...env, KIN_TWILIO_CALLER_NUMBER: "" }).twilioCallerNumber).toBeNull();
    expect(read(on, { ...env, KIN_TWILIO_CALLER_NUMBER: "+15551234567" }).twilioCallerNumber).toBe("+15551234567");
    expect(read({ ...on, "kin:twilioCallerNumber": "+41225550100" }, { ...env, KIN_TWILIO_CALLER_NUMBER: "+15551234567" }).twilioCallerNumber).toBe("+41225550100");
    for (const bad of ["15551234567", "+0551234567", "+1 555 123 4567", "+1555", "(555) 123-4567"]) {
      expect(() => read(on, { ...env, KIN_TWILIO_CALLER_NUMBER: bad })).toThrow(InfraConfigError);
    }
    // The worker places the call, and the voice service answers it.
    expect(() => read({ "kin:voice": true }, { ...env, KIN_TWILIO_CALLER_NUMBER: "+15551234567" })).toThrow(InfraConfigError);
    expect(() => read({ "kin:paypal": paypal }, { ...env, KIN_TWILIO_CALLER_NUMBER: "+15551234567" })).toThrow(InfraConfigError);
  });

  it("takes the text sender from cdk.json or the environment, as a number or a messaging service, or leaves texting off", () => {
    expect(read().twilioSmsFrom).toBeNull();
    expect(read({}, { ...env, KIN_TWILIO_SMS_FROM: "" }).twilioSmsFrom).toBeNull();
    expect(read({}, { ...env, KIN_TWILIO_SMS_FROM: "+15551234567" }).twilioSmsFrom).toBe("+15551234567");
    const service = `MG${"a1".repeat(16)}`;
    expect(read({ "kin:twilioSmsFrom": service }).twilioSmsFrom).toBe(service);
    for (const bad of ["5551234567", "MG123", `AC${"a1".repeat(16)}`, "sender"]) {
      expect(() => read({}, { ...env, KIN_TWILIO_SMS_FROM: bad })).toThrow(InfraConfigError);
    }
    // Texting is the web app's own and needs neither the worker nor the voice service.
    expect(read({}, { ...env, KIN_TWILIO_SMS_FROM: "+15551234567" }).voice).toBe(false);
  });

  it("switches the worker's call loop on only when the worker, the voice service, a number and an address all exist", () => {
    const paypal = { clientId: "client", webhookId: "WH-1" };
    const url = "https://abc123.us-east-1.awsapprunner.com";
    const all = { "kin:paypal": paypal, "kin:voice": true, "kin:voicePublicUrl": url, "kin:twilioCallerNumber": "+15551234567" };
    expect(shiftCallSettings(read(all))).toEqual({ callerNumber: "+15551234567", publicUrl: url });
    expect(shiftCallSettings(read({ ...all, "kin:voicePublicUrl": undefined }))).toBeNull();
    expect(shiftCallSettings(read({ ...all, "kin:twilioCallerNumber": undefined }))).toBeNull();
    expect(shiftCallSettings(read({ "kin:paypal": paypal, "kin:voice": true }))).toBeNull();
    expect(shiftCallSettings(read({}))).toBeNull();
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

describe("the presence line and the family-member texts", () => {
  const numbers = { "+15555550200": "0b6f7a53-0c5b-4a3f-8d2e-6a1b2c3d4e5f" };

  it("takes the line's numbers from cdk.json or the environment, as E.164 to a circle, only with the voice service", () => {
    expect(read().presenceLineNumbers).toBeNull();
    expect(read({}, { ...env, KIN_PRESENCE_LINE_NUMBERS: "" }).presenceLineNumbers).toBeNull();
    expect(read({ "kin:voice": true, "kin:presenceLineNumbers": numbers }).presenceLineNumbers).toBe(JSON.stringify(numbers));
    expect(read({ "kin:voice": true }, { ...env, KIN_PRESENCE_LINE_NUMBERS: JSON.stringify(numbers) }).presenceLineNumbers).toBe(JSON.stringify(numbers));
    for (const bad of ["not json", "[]", "{}", JSON.stringify({ "5555550200": "x" })]) {
      expect(() => read({ "kin:voice": true }, { ...env, KIN_PRESENCE_LINE_NUMBERS: bad })).toThrow(InfraConfigError);
    }
    expect(() => read({ "kin:presenceLineNumbers": numbers })).toThrow(InfraConfigError);
  });

  it("gives the worker the texts' settings only with the PayPal app, a sender and the web app's https address", () => {
    const paypal = { clientId: "client", webhookId: "WH-1" };
    const origin = "https://abc123.us-east-1.awsapprunner.com";
    const settings = (overrides: Record<string, unknown>, environment: Record<string, string | undefined> = env) => presenceTextSettings(read(overrides, environment));
    const sms = { ...env, KIN_TWILIO_SMS_FROM: "+15551234567" };
    expect(settings({ "kin:paypal": paypal, "kin:webOrigins": ["http://localhost:3000", origin] }, sms)).toEqual({ from: "+15551234567", webUrl: origin });
    expect(settings({ "kin:webOrigins": ["http://localhost:3000", origin] }, sms)).toBeNull();
    expect(settings({ "kin:paypal": paypal, "kin:webOrigins": ["http://localhost:3000", origin] })).toBeNull();
    expect(settings({ "kin:paypal": paypal }, sms)).toBeNull();
  });
});
