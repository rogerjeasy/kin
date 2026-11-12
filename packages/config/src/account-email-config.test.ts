import { describe, expect, it } from "vitest";

import { readAccountEmailConfig } from "./account-email-config.ts";
import { ConfigError } from "./config-error.ts";

describe("the web app's account email", () => {
  it("is off, naming what is missing, until the sender and its app password are both set", () => {
    expect(readAccountEmailConfig({})).toEqual({ enabled: false, missing: ["KIN_SENDER_EMAIL", "KIN_GMAIL_APP_PASSWORD"] });
    expect(readAccountEmailConfig({ KIN_SENDER_EMAIL: "kin@example.com" })).toEqual({ enabled: false, missing: ["KIN_GMAIL_APP_PASSWORD"] });
  });

  it("is on with both, and refuses a malformed value without echoing it", () => {
    expect(readAccountEmailConfig({ KIN_SENDER_EMAIL: "kin@example.com", KIN_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" })).toEqual({ enabled: true, sender: "kin@example.com", appPassword: "abcd efgh ijkl mnop" });
    expect(() => readAccountEmailConfig({ KIN_SENDER_EMAIL: "kin", KIN_GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" })).toThrow(ConfigError);
    expect(() => readAccountEmailConfig({ KIN_SENDER_EMAIL: "kin@example.com", KIN_GMAIL_APP_PASSWORD: "secret-short" })).toThrow(/too short/);
    expect(() => readAccountEmailConfig({ KIN_SENDER_EMAIL: "kin@example.com", KIN_GMAIL_APP_PASSWORD: "secret-short" })).not.toThrow(/secret-short/);
  });
});
