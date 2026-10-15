import { EmailDeliveryError, type EmailSender } from "@kin/notify";
import { describe, expect, it } from "vitest";

import { InvalidEventError, maskEmail } from "./event.ts";
import { createEmailSenderHandler } from "./handler.ts";

const POOL = "us-east-1_Pool";

function event(triggerSource: string, overrides: Record<string, unknown> = {}) {
  return {
    triggerSource,
    userPoolId: POOL,
    request: { type: "customEmailSenderRequestV1", code: "ENCRYPTED", userAttributes: { email: "elena@example.com", sub: "1" } },
    ...overrides,
  };
}

function harness(options: { fail?: Error; decrypted?: string } = {}) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const logs: Record<string, string>[] = [];
  const decrypted: [string, string][] = [];
  const sender: EmailSender = {
    async send(message) {
      if (options.fail) throw options.fail;
      sent.push(message);
    },
  };
  const handler = createEmailSenderHandler({
    async decrypt(code, pool) {
      decrypted.push([code, pool]);
      return options.decrypted ?? "482915";
    },
    sender: async () => sender,
    log: (entry) => logs.push(entry),
  });
  return { handler, sent, logs, decrypted };
}

describe("Cognito's custom email sender", () => {
  it.each([
    ["CustomEmailSender_SignUp", "Your code to confirm your email address for Kin is 482915."],
    ["CustomEmailSender_ResendCode", "Your code to confirm your email address for Kin is 482915."],
    ["CustomEmailSender_Authentication", "Your code to sign in to Kin is 482915."],
    ["CustomEmailSender_ForgotPassword", "Your code to reset your Kin password is 482915."],
    ["CustomEmailSender_UpdateUserAttribute", "Your code to confirm your new email address for Kin is 482915."],
    ["CustomEmailSender_VerifyUserAttribute", "Your code to confirm your new email address for Kin is 482915."],
  ])("delivers the decrypted code for %s", async (trigger, firstLine) => {
    const { handler, sent, decrypted } = harness();

    await handler(event(trigger));

    expect(decrypted).toEqual([["ENCRYPTED", POOL]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("elena@example.com");
    expect(sent[0]?.text.split("\n")[0]).toBe(firstLine);
  });

  it("restores the characters Cognito escapes in a temporary password", async () => {
    const { handler, sent } = harness({ decrypted: "a&lt;b&gt;c&amp;d" });

    await handler(event("CustomEmailSender_AdminCreateUser"));

    expect(sent[0]?.text).toContain("a<b>c&d");
  });

  it("sends nothing for a notice Kin does not use, and says so in the log", async () => {
    const { handler, sent, logs } = harness();

    await handler(event("CustomEmailSender_AccountTakeOverNotification", { request: { userAttributes: { email: "elena@example.com" } } }));

    expect(sent).toEqual([]);
    expect(logs).toEqual([{ outcome: "not_sent", triggerSource: "CustomEmailSender_AccountTakeOverNotification", to: "e***@example.com" }]);
  });

  it("logs who was emailed without the code or the full address", async () => {
    const { handler, logs } = harness();

    await handler(event("CustomEmailSender_Authentication"));

    expect(JSON.stringify(logs)).not.toContain("482915");
    expect(JSON.stringify(logs)).not.toContain("elena@");
  });

  it("lets a failed delivery fail, so Cognito reports it", async () => {
    const { handler } = harness({ fail: new EmailDeliveryError("Gmail did not accept the email", true) });

    await expect(handler(event("CustomEmailSender_Authentication"))).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it.each([
    ["not an object", "event"],
    ["an unknown trigger", event("CustomEmailSender_Other")],
    ["no user pool", event("CustomEmailSender_SignUp", { userPoolId: "" })],
    ["no email address", event("CustomEmailSender_SignUp", { request: { code: "E", userAttributes: {} } })],
    ["a code that is not text", event("CustomEmailSender_SignUp", { request: { code: 7, userAttributes: { email: "a@b.c" } } })],
    ["no code for a sign-in", event("CustomEmailSender_Authentication", { request: { userAttributes: { email: "a@b.c" } } })],
  ])("refuses an event with %s", async (_case, raw) => {
    const { handler, sent } = harness();

    await expect(handler(raw)).rejects.toBeInstanceOf(InvalidEventError);
    expect(sent).toEqual([]);
  });
});

describe("an address in the logs", () => {
  it("keeps only its first letter and its domain", () => {
    expect(maskEmail("elena.moreau@example.com")).toBe("e***@example.com");
  });
});
