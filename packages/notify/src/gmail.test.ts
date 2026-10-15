import { describe, expect, it } from "vitest";

import { EmailDeliveryError } from "./email-sender.ts";
import { createGmailSender, normalizeAppPassword, type GmailTransport } from "./gmail.ts";

function recording(fail?: unknown) {
  const sent: unknown[] = [];
  const opened: unknown[] = [];
  const transport: GmailTransport = (account) => {
    opened.push(account);
    return {
      sendMail: async (mail) => {
        if (fail) throw fail;
        sent.push(mail);
      },
    };
  };
  return { transport, sent, opened };
}

const account = { address: "kin.family@gmail.com", appPassword: "abcd efgh ijkl mnop" };

describe("the Gmail sender", () => {
  it("signs in with the app password without its spaces, and sends as Kin from the account", async () => {
    const { transport, sent, opened } = recording();

    await createGmailSender(account, transport).send({ to: "elena@example.com", subject: "S", text: "T" });

    expect(opened).toEqual([{ address: "kin.family@gmail.com", appPassword: "abcdefghijklmnop" }]);
    expect(sent).toEqual([{ from: { name: "Kin", address: "kin.family@gmail.com" }, to: "elena@example.com", subject: "S", text: "T" }]);
  });

  it("refuses to start without an address and a password", () => {
    expect(() => createGmailSender({ ...account, appPassword: "   " }, recording().transport)).toThrow(EmailDeliveryError);
    expect(() => createGmailSender({ ...account, address: "kin" }, recording().transport)).toThrow(EmailDeliveryError);
  });

  it("says a refused password cannot be retried, and a failed send can", async () => {
    const refused = createGmailSender(account, recording(Object.assign(new Error("535"), { code: "EAUTH" })).transport);
    const failed = createGmailSender(account, recording(new Error("ETIMEDOUT")).transport);
    const mail = { to: "a@example.com", subject: "S", text: "T" };

    await expect(refused.send(mail)).rejects.toMatchObject({ retryable: false });
    await expect(failed.send(mail)).rejects.toMatchObject({ retryable: true });
  });

  it("never puts the password in an error message", async () => {
    const sender = createGmailSender(account, recording(new Error(`auth failed for ${account.appPassword}`)).transport);

    await expect(sender.send({ to: "a@example.com", subject: "S", text: "T" })).rejects.not.toThrow(/abcd/);
  });
});

describe("an app password", () => {
  it("is read without the spaces Google shows it with", () => {
    expect(normalizeAppPassword(" abcd efgh\tijkl mnop ")).toBe("abcdefghijklmnop");
  });
});
