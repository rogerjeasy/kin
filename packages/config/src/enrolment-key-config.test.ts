import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readEnrolmentKey } from "./enrolment-key-config.ts";

const demoKey = "d".repeat(40);

describe("the key that seals an authenticator enrolment", () => {
  it("is derived from Kin's own enrolment key when one is set", () => {
    const key = readEnrolmentKey({ KIN_ENROLMENT_KEY: "e".repeat(40) });
    expect(key).toHaveLength(32);
    expect(key?.equals(createHmac("sha256", "e".repeat(40)).update("kin authenticator enrolment key v1").digest())).toBe(true);
  });

  it("is otherwise derived from the demo session key under its own label, never the key itself", () => {
    const key = readEnrolmentKey({ KIN_DEMO_CIRCLES: "on", KIN_DEMO_SESSION_KEY: demoKey });
    expect(key).toHaveLength(32);
    expect(key?.toString("utf8")).not.toContain(demoKey);
    expect(key?.equals(createHmac("sha256", demoKey).update("kin agency signing key v1").digest())).toBe(false);
  });

  it("is absent without either, and refuses a short key", () => {
    expect(readEnrolmentKey({})).toBeNull();
    expect(readEnrolmentKey({ KIN_DEMO_SESSION_KEY: demoKey })).toBeNull();
    expect(() => readEnrolmentKey({ KIN_ENROLMENT_KEY: "short" })).toThrow(ConfigError);
  });
});
