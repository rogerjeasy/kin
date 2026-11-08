import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { SHIFT_CALL_ENV, readShiftCallConfig } from "./shift-call-config.ts";

const ALL = {
  KIN_TWILIO_ACCOUNT_SID: `AC${"0123456789abcdef".repeat(2)}`,
  KIN_TWILIO_AUTH_TOKEN: "twilio-auth-token-0123456789",
  KIN_TWILIO_CALLER_NUMBER: "+15555550100",
  KIN_VOICE_PUBLIC_URL: "https://voice.example.com/",
  KIN_VOICE_STATE_KEY: "state-key-0123456789abcdef0123456789abcdef",
};

describe("the settings of the call to the parent", () => {
  it("are on when all five are set, with the address cleaned of its trailing slash", () => {
    expect(readShiftCallConfig(ALL)).toEqual({
      enabled: true,
      accountSid: ALL.KIN_TWILIO_ACCOUNT_SID,
      authToken: ALL.KIN_TWILIO_AUTH_TOKEN,
      callerNumber: "+15555550100",
      publicUrl: "https://voice.example.com",
      tokenKey: ALL.KIN_VOICE_STATE_KEY,
    });
  });

  it("are off, naming everything missing, when nothing is set", () => {
    expect(readShiftCallConfig({})).toEqual({ enabled: false, missing: Object.values(SHIFT_CALL_ENV) });
  });

  it("are off, naming only what is missing and never a value, when one is not set", () => {
    for (const name of Object.values(SHIFT_CALL_ENV)) {
      const partial = { ...ALL, [name]: "  " };
      expect(readShiftCallConfig(partial)).toEqual({ enabled: false, missing: [name] });
    }
  });

  it("refuse a value that is set but wrong, without quoting any value", () => {
    const wrong: [string, string][] = [
      ["KIN_TWILIO_ACCOUNT_SID", "SK0123"],
      ["KIN_TWILIO_AUTH_TOKEN", "tok123"],
      ["KIN_TWILIO_CALLER_NUMBER", "555-0100"],
      ["KIN_VOICE_PUBLIC_URL", "http://voice.example.com"],
      ["KIN_VOICE_PUBLIC_URL", "https://voice.example.com/path"],
      ["KIN_VOICE_PUBLIC_URL", "https://voice_service.example.com"],
      ["KIN_VOICE_STATE_KEY", "key123"],
    ];
    for (const [name, bad] of wrong) {
      const attempt = () => readShiftCallConfig({ ...ALL, [name]: bad });
      expect(attempt, `${name}=${bad}`).toThrow(ConfigError);
      try {
        attempt();
      } catch (error) {
        expect(String(error)).not.toContain(bad);
      }
    }
  });

  it("refuse the same value for the token key and Twilio's auth token", () => {
    const same = "same-secret-0123456789abcdef0123456789";
    expect(() => readShiftCallConfig({ ...ALL, KIN_TWILIO_AUTH_TOKEN: same, KIN_VOICE_STATE_KEY: same })).toThrow(/must differ/);
  });
});
