import { describe, expect, it } from "vitest";

import { TEXT_ENV, readTextSender } from "./text-sender";

const ALL = { [TEXT_ENV.accountSid]: `AC${"a".repeat(32)}`, [TEXT_ENV.authToken]: "secret-token-value", [TEXT_ENV.from]: "+15005550006" };

describe("the text sender's settings", () => {
  it("is off until all three are set", () => {
    expect(readTextSender({})).toBeNull();
    for (const name of Object.values(TEXT_ENV)) expect(readTextSender({ ...ALL, [name]: "" }), name).toBeNull();
  });

  it("is on with a number or a messaging service to send from", () => {
    expect(readTextSender(ALL)).not.toBeNull();
    expect(readTextSender({ ...ALL, [TEXT_ENV.from]: `MG${"b".repeat(32)}` })).not.toBeNull();
  });

  it("is off, not broken, when a setting is malformed", () => {
    expect(readTextSender({ ...ALL, [TEXT_ENV.accountSid]: "not-a-sid" })).toBeNull();
    expect(readTextSender({ ...ALL, [TEXT_ENV.from]: "12345" })).toBeNull();
  });
});
