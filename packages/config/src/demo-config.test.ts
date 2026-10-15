import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readDemoConfig } from "./demo-config.ts";

describe("the demo settings", () => {
  it("leave the demo off unless it is switched on", () => {
    expect(readDemoConfig({})).toEqual({ enabled: false });
    expect(readDemoConfig({ KIN_DEMO_CIRCLES: "yes", KIN_DEMO_SESSION_KEY: "k".repeat(40) })).toEqual({ enabled: false });
  });

  it("switched on, carry the key that signs visitors' sessions", () => {
    expect(readDemoConfig({ KIN_DEMO_CIRCLES: "on", KIN_DEMO_SESSION_KEY: "k".repeat(40) })).toEqual({ enabled: true, sessionKey: "k".repeat(40) });
  });

  it("refuse to start with a missing or short key", () => {
    expect(() => readDemoConfig({ KIN_DEMO_CIRCLES: "on" })).toThrow(ConfigError);
    expect(() => readDemoConfig({ KIN_DEMO_CIRCLES: "on", KIN_DEMO_SESSION_KEY: "short" })).toThrow(/32/);
  });
});
