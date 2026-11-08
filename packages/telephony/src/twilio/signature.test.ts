import { describe, expect, it } from "vitest";

import { twilioSignature, verifyTwilioSignature } from "./signature.ts";

// The worked example in Twilio's own documentation of request signing.
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const TOKEN = "12345";
const PARAMS = [
  ["Digits", "1234"],
  ["To", "+18005551212"],
  ["From", "+14158675310"],
  ["Caller", "+14158675310"],
  ["CallSid", "CA1234567890ABCDE"],
] as const;
const DOCUMENTED = "GvWf1cFY/Q7PnoempGyD5oXAezc=";

describe("Twilio's request signature", () => {
  it("is the one Twilio documents for its worked example, whatever order the fields arrive in", () => {
    expect(twilioSignature(URL, PARAMS, TOKEN)).toBe(DOCUMENTED);
    expect(twilioSignature(URL, PARAMS.toReversed(), TOKEN)).toBe(DOCUMENTED);
  });

  it("verifies a request signed with the auth token", () => {
    expect(verifyTwilioSignature({ url: URL, params: PARAMS, header: DOCUMENTED, authToken: TOKEN })).toBe(true);
  });

  it("refuses a signature made with another token", () => {
    expect(verifyTwilioSignature({ url: URL, params: PARAMS, header: DOCUMENTED, authToken: "54321" })).toBe(false);
  });

  it("refuses a request whose field, URL or field set was changed after signing", () => {
    const tampered = PARAMS.map(([name, value]) => [name, name === "Digits" ? "9999" : value] as const);
    expect(verifyTwilioSignature({ url: URL, params: tampered, header: DOCUMENTED, authToken: TOKEN })).toBe(false);
    expect(verifyTwilioSignature({ url: `${URL}&x=1`, params: PARAMS, header: DOCUMENTED, authToken: TOKEN })).toBe(false);
    expect(verifyTwilioSignature({ url: URL, params: [...PARAMS, ["Extra", "1"]], header: DOCUMENTED, authToken: TOKEN })).toBe(false);
  });

  it("refuses a missing, empty or malformed header", () => {
    for (const header of [undefined, "", "not-a-signature", `${DOCUMENTED}${DOCUMENTED}`]) {
      expect(verifyTwilioSignature({ url: URL, params: PARAMS, header, authToken: TOKEN })).toBe(false);
    }
  });
});
