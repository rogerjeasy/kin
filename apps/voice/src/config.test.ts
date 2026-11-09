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

  it("start with no office line when KIN_OFFICE_LINE_NUMBERS is unset or blank, so the shift call can run alone", () => {
    const shiftCallOnly = { ...ENV, KIN_OFFICE_LINE_NUMBERS: undefined };
    expect(readVoiceConfig(shiftCallOnly).numbers.size).toBe(0);
    expect(readVoiceConfig({ ...shiftCallOnly, KIN_OFFICE_LINE_NUMBERS: "  " }).numbers.size).toBe(0);
    expect(readVoiceConfig({ ...shiftCallOnly, KIN_OFFICE_LINE_NUMBERS: "" }).numbers.get("+15555550100")).toBeUndefined();
  });

  it("still read a set office line exactly as before, and refuse a set one that is empty or malformed", () => {
    expect(readVoiceConfig(ENV).numbers.get("+15555550100")).toEqual({ circleId: CIRCLE, locale: "en" });
    for (const text of ["{}", "[]", "not json", JSON.stringify({ "5555550100": CIRCLE })]) {
      expect(() => readVoiceConfig({ ...ENV, KIN_OFFICE_LINE_NUMBERS: text })).toThrow(ConfigError);
    }
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

describe("the presence line's numbers", () => {
  it("are read like the office line's, name the setting in their errors, and are empty when unset", () => {
    expect(readVoiceConfig(ENV).presenceNumbers.size).toBe(0);
    const config = readVoiceConfig({ ...ENV, KIN_PRESENCE_LINE_NUMBERS: JSON.stringify({ "+15555550200": { circleId: CIRCLE, locale: "he" } }) });
    expect(config.presenceNumbers.get("+15555550200")).toEqual({ circleId: CIRCLE, locale: "he" });
    expect(() => readVoiceConfig({ ...ENV, KIN_PRESENCE_LINE_NUMBERS: "not json" })).toThrow("KIN_PRESENCE_LINE_NUMBERS is not JSON");
  });

  it("refuse a number that the office line already answers, so no call is taken twice over", () => {
    expect(() => readVoiceConfig({ ...ENV, KIN_PRESENCE_LINE_NUMBERS: JSON.stringify({ "+15555550100": OTHER }) })).toThrow(ConfigError);
  });
});
