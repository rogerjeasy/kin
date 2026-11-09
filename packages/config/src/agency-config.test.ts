import { describe, expect, it } from "vitest";

import { readAgencySigningKey } from "./agency-config.ts";
import { ConfigError } from "./config-error.ts";

const DEMO = { KIN_DEMO_CIRCLES: "on", KIN_DEMO_SESSION_KEY: "a demo session key of at least thirty-two characters" };

describe("the agency signing key", () => {
  it("is the dedicated key when it is set", () => {
    const key = "a dedicated agency signing key, thirty-two or more";
    expect(readAgencySigningKey({ ...DEMO, KIN_AGENCY_SIGNING_KEY: key })).toBe(key);
  });

  it("refuses a dedicated key that is too short", () => {
    expect(() => readAgencySigningKey({ KIN_AGENCY_SIGNING_KEY: "short" })).toThrow(ConfigError);
  });

  it("is derived from the demo session key without one, and is never the demo key itself", () => {
    const derived = readAgencySigningKey(DEMO);
    expect(derived).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(derived).not.toBe(DEMO.KIN_DEMO_SESSION_KEY);
    expect(readAgencySigningKey(DEMO)).toBe(derived);
  });

  it("is off with neither", () => {
    expect(readAgencySigningKey({})).toBeNull();
    expect(readAgencySigningKey({ ...DEMO, KIN_DEMO_CIRCLES: "off" })).toBeNull();
  });
});
