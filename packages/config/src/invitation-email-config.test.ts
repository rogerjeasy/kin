import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { INVITATION_EMAILS_PER_DAY_DEFAULT, INVITATION_EMAIL_ENV, readInvitationEmailConfig } from "./invitation-email-config.ts";

const ENV = {
  KIN_SENDER_EMAIL: "kin.family@example.com",
  KIN_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
  KIN_WEB_PUBLIC_URL: "https://kin.example.com/",
};

describe("the settings of the invitation email", () => {
  it("are on when all three are set, with the address stripped of its trailing slash", () => {
    expect(readInvitationEmailConfig(ENV)).toEqual({ enabled: true, sender: ENV.KIN_SENDER_EMAIL, appPassword: ENV.KIN_GMAIL_APP_PASSWORD, webUrl: "https://kin.example.com", perDay: INVITATION_EMAILS_PER_DAY_DEFAULT });
  });

  it("send at most two hundred a day unless told fewer or a few more, never enough to starve the sign-in codes", () => {
    expect(INVITATION_EMAILS_PER_DAY_DEFAULT).toBe(200);
    expect(readInvitationEmailConfig({ ...ENV, KIN_INVITATION_EMAILS_PER_DAY: "50" })).toMatchObject({ perDay: 50 });
    for (const perDay of ["0", "-1", "1.5", "301", "500", "lots"]) {
      expect(() => readInvitationEmailConfig({ ...ENV, KIN_INVITATION_EMAILS_PER_DAY: perDay })).toThrow(ConfigError);
    }
  });

  it("are off, naming only the settings that are missing and never a value, when any is not set", () => {
    expect(readInvitationEmailConfig({})).toEqual({ enabled: false, missing: Object.values(INVITATION_EMAIL_ENV) });
    expect(readInvitationEmailConfig({ ...ENV, KIN_GMAIL_APP_PASSWORD: " " })).toEqual({ enabled: false, missing: ["KIN_GMAIL_APP_PASSWORD"] });
  });

  it("refuse a malformed setting, and an address that is not plain HTTPS, since the link is emailed", () => {
    for (const change of [{ KIN_SENDER_EMAIL: "kin" }, { KIN_GMAIL_APP_PASSWORD: "short" }, { KIN_WEB_PUBLIC_URL: "http://kin.example.com" }, { KIN_WEB_PUBLIC_URL: "https://kin.example.com/app" }, { KIN_WEB_PUBLIC_URL: "https://u:p@kin.example.com" }]) {
      expect(() => readInvitationEmailConfig({ ...ENV, ...change })).toThrow(ConfigError);
    }
  });

  it("never puts a value in a message", () => {
    try {
      readInvitationEmailConfig({ ...ENV, KIN_GMAIL_APP_PASSWORD: "secretpw" });
    } catch (error) {
      expect(String(error)).not.toContain("secretpw");
    }
  });
});
