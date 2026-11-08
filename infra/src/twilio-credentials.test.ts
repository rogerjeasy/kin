import { describe, expect, it } from "vitest";

import { readTwilioCredentials } from "./twilio-credentials.ts";

const SID = `AC${"0123456789abcdef".repeat(2)}`;
const TOKEN = "0123456789abcdef0123456789abcdef";

describe("the Twilio credentials to store", () => {
  it("are an account SID of AC and 32 hex characters and an auth token of at least 32 letters and digits, trimmed", () => {
    expect(readTwilioCredentials({ KIN_TWILIO_ACCOUNT_SID: ` ${SID}\n`, KIN_TWILIO_AUTH_TOKEN: ` ${TOKEN} ` })).toEqual({ ok: true, credentials: { accountSid: SID, authToken: TOKEN } });
    expect(readTwilioCredentials({ KIN_TWILIO_ACCOUNT_SID: SID, KIN_TWILIO_AUTH_TOKEN: `${TOKEN}Zz9` }).ok).toBe(true);
  });

  it("are refused when missing, mistyped, or the wrong length, naming the setting and never its value", () => {
    const bad: Record<string, string | undefined>[] = [
      {},
      { KIN_TWILIO_ACCOUNT_SID: SID },
      { KIN_TWILIO_AUTH_TOKEN: TOKEN },
      { KIN_TWILIO_ACCOUNT_SID: `SK${SID.slice(2)}`, KIN_TWILIO_AUTH_TOKEN: TOKEN },
      { KIN_TWILIO_ACCOUNT_SID: SID.slice(0, 33), KIN_TWILIO_AUTH_TOKEN: TOKEN },
      { KIN_TWILIO_ACCOUNT_SID: `${SID}0`, KIN_TWILIO_AUTH_TOKEN: TOKEN },
      { KIN_TWILIO_ACCOUNT_SID: `AC${"z".repeat(32)}`, KIN_TWILIO_AUTH_TOKEN: TOKEN },
      { KIN_TWILIO_ACCOUNT_SID: SID, KIN_TWILIO_AUTH_TOKEN: TOKEN.slice(0, 31) },
      { KIN_TWILIO_ACCOUNT_SID: SID, KIN_TWILIO_AUTH_TOKEN: `${TOKEN.slice(0, 31)}!` },
      { KIN_TWILIO_ACCOUNT_SID: SID, KIN_TWILIO_AUTH_TOKEN: "   " },
    ];
    for (const env of bad) {
      const result = readTwilioCredentials(env);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problems.length).toBeGreaterThan(0);
        for (const problem of result.problems) {
          expect(problem).toMatch(/KIN_TWILIO_(ACCOUNT_SID|AUTH_TOKEN)/);
          for (const value of Object.values(env)) if (value !== undefined && value.trim() !== "") expect(problem).not.toContain(value.trim());
        }
      }
    }
  });

  it("report both problems at once", () => {
    const result = readTwilioCredentials({});
    expect(result.ok ? [] : result.problems).toHaveLength(2);
  });
});
