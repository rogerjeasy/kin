import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readSandboxPayoutConfig } from "./sandbox-payout-config.ts";

const EMAIL = "sb-kin-payee@personal.example.com";

describe("the demo's sandbox payout settings", () => {
  it("are off when no Kin sandbox address is named, so every demo payout stays simulated", () => {
    expect(readSandboxPayoutConfig({})).toEqual({ enabled: false });
    expect(readSandboxPayoutConfig({ KIN_DEMO_SANDBOX_PAYEE_EMAIL: "  " })).toEqual({ enabled: false });
    expect(readSandboxPayoutConfig({ KIN_DEMO_SANDBOX_PAYOUTS_PER_DAY: "3" })).toEqual({ enabled: false });
  });

  it("carry the one address and a daily limit of 25 by default", () => {
    expect(readSandboxPayoutConfig({ KIN_DEMO_SANDBOX_PAYEE_EMAIL: ` ${EMAIL} ` })).toEqual({ enabled: true, payeeEmail: EMAIL, dailyLimit: 25 });
    expect(readSandboxPayoutConfig({ KIN_DEMO_SANDBOX_PAYEE_EMAIL: EMAIL, KIN_DEMO_SANDBOX_PAYOUTS_PER_DAY: "3" })).toMatchObject({ dailyLimit: 3 });
  });

  it("refuse anything that is not one plain email address", () => {
    for (const bad of ["kin", "kin@", "@example.com", "a@b", "two words@example.com", "a@example.com, b@example.com", "Kin <kin@example.com>", `${"a".repeat(250)}@example.com`]) {
      expect(() => readSandboxPayoutConfig({ KIN_DEMO_SANDBOX_PAYEE_EMAIL: bad }), bad).toThrow(ConfigError);
    }
  });

  it("refuse a daily limit that is not a whole number from 1 to 1000", () => {
    for (const bad of ["0", "-1", "2.5", "ten", "1001", "1e3"]) {
      expect(() => readSandboxPayoutConfig({ KIN_DEMO_SANDBOX_PAYEE_EMAIL: EMAIL, KIN_DEMO_SANDBOX_PAYOUTS_PER_DAY: bad }), bad).toThrow(/1 to 1000/);
    }
  });
});
