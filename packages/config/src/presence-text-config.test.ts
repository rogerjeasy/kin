import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { PRESENCE_TEXT_ENV, readPresenceTextConfig } from "./presence-text-config.ts";

const ENV = {
  KIN_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  KIN_TWILIO_AUTH_TOKEN: "t".repeat(32),
  KIN_TWILIO_SMS_FROM: "+15555550100",
  KIN_WEB_PUBLIC_URL: "https://kin.example.com/",
};

describe("the settings of the texts to a family member", () => {
  it("are on when all four are set, with the address stripped of its trailing slash", () => {
    expect(readPresenceTextConfig(ENV)).toEqual({ enabled: true, accountSid: ENV.KIN_TWILIO_ACCOUNT_SID, authToken: ENV.KIN_TWILIO_AUTH_TOKEN, sender: { from: "+15555550100" }, webUrl: "https://kin.example.com" });
    expect(readPresenceTextConfig({ ...ENV, KIN_TWILIO_SMS_FROM: `MG${"b".repeat(32)}` })).toMatchObject({ sender: { messagingServiceSid: `MG${"b".repeat(32)}` } });
  });

  it("are off, naming only the settings that are missing and never a value, when any is not set", () => {
    expect(readPresenceTextConfig({})).toEqual({ enabled: false, missing: Object.values(PRESENCE_TEXT_ENV) });
    expect(readPresenceTextConfig({ ...ENV, KIN_WEB_PUBLIC_URL: " " })).toEqual({ enabled: false, missing: ["KIN_WEB_PUBLIC_URL"] });
  });

  it("refuse a malformed setting, and an address that is not plain HTTPS, since it carries a secret to a phone", () => {
    for (const change of [{ KIN_TWILIO_ACCOUNT_SID: "nope" }, { KIN_TWILIO_AUTH_TOKEN: "short" }, { KIN_TWILIO_SMS_FROM: "0123" }, { KIN_WEB_PUBLIC_URL: "http://kin.example.com" }, { KIN_WEB_PUBLIC_URL: "https://kin.example.com/app" }, { KIN_WEB_PUBLIC_URL: "https://u:p@kin.example.com" }]) {
      expect(() => readPresenceTextConfig({ ...ENV, ...change })).toThrow(ConfigError);
    }
  });
});
