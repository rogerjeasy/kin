import { ConfigError } from "@kin/config";
import { describe, expect, it } from "vitest";

import { readLineNumbers, readVoiceConfig } from "./config.ts";

const CIRCLE = "0b6f7a53-0c5b-4a3f-8d2e-6a1b2c3d4e5f";
const OTHER = "1c7f8b64-1d6c-4b4f-9e3f-7b2c3d4e5f60";
const ENV = {
  KIN_OFFICE_LINE_NUMBERS: JSON.stringify({ "+15555550100": CIRCLE }),
  KIN_TWILIO_AUTH_TOKEN: "t".repeat(32),
  KIN_VOICE_STATE_KEY: "s".repeat(40),
  KIN_VOICE_PUBLIC_URL: "https://voice.example.com/",
};

describe("the number to circle map", () => {
  it("maps each dialled number to its one circle, in English unless the number says otherwise", () => {
    const numbers = readLineNumbers(JSON.stringify({ "+15555550100": CIRCLE, "+41225550100": { circleId: OTHER.toUpperCase(), locale: "fr" } }));
    expect(numbers.get("+15555550100")).toEqual({ circleId: CIRCLE, locale: "en" });
    expect(numbers.get("+41225550100")).toEqual({ circleId: OTHER, locale: "fr" });
    expect(numbers.get("+15555550199")).toBeUndefined();
  });

  it("refuses anything it cannot read, so a wrong line takes no calls", () => {
    const bad = [
      "not json",
      "[]",
      "{}",
      JSON.stringify({ "5555550100": CIRCLE }),
      JSON.stringify({ "+15555550100": "not-a-uuid" }),
      JSON.stringify({ "+15555550100": { circleId: CIRCLE, locale: "xx" } }),
      JSON.stringify({ "+15555550100": { circleId: CIRCLE, extra: 1 } }),
      JSON.stringify({ "+15555550100": 7 }),
      JSON.stringify({ "+15555550100": CIRCLE, "+15555550101": CIRCLE }),
    ];
    for (const text of bad) expect(() => readLineNumbers(text)).toThrow(ConfigError);
  });
});

describe("the voice settings", () => {
  it("are read with the address stripped of its trailing slash and a default port", () => {
    const config = readVoiceConfig(ENV);
    expect(config).toMatchObject({ publicUrl: "https://voice.example.com", port: 4200, authToken: ENV.KIN_TWILIO_AUTH_TOKEN });
    expect(readVoiceConfig({ ...ENV, PORT: "8080" }).port).toBe(8080);
  });

  it("refuse missing secrets, weak keys, a shared key, a plain-http public address and a bad port", () => {
    for (const patch of [
      { KIN_TWILIO_AUTH_TOKEN: undefined },
      { KIN_VOICE_STATE_KEY: undefined },
      { KIN_VOICE_STATE_KEY: "short" },
      { KIN_TWILIO_AUTH_TOKEN: "short" },
      { KIN_VOICE_STATE_KEY: ENV.KIN_TWILIO_AUTH_TOKEN },
      { KIN_VOICE_PUBLIC_URL: "http://voice.example.com" },
      { KIN_VOICE_PUBLIC_URL: "https://voice.example.com/path" },
      { PORT: "http" },
    ]) {
      expect(() => readVoiceConfig({ ...ENV, ...patch })).toThrow(ConfigError);
    }
  });
});
