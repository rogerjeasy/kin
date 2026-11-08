import { describe, expect, it } from "vitest";

import { parseVoiceRequest } from "./voice-request.ts";

const SID = `CA${"0".repeat(32)}`;
const base: [string, string][] = [
  ["CallSid", SID],
  ["From", "+15555550199"],
  ["To", "+15555550100"],
];

describe("a voice webhook's fields", () => {
  it("are read into the few the conversation uses", () => {
    expect(parseVoiceRequest([...base, ["SpeechResult", "  Mike  "], ["Digits", "12#"], ["CallStatus", "in-progress"], ["AccountSid", "ACx"]])).toEqual({
      callSid: SID,
      from: "+15555550199",
      to: "+15555550100",
      speech: "Mike",
      digits: "12#",
      callStatus: "in-progress",
    });
  });

  it("treat a withheld caller ID as no number rather than refusing the call", () => {
    expect(parseVoiceRequest([["CallSid", SID], ["From", "anonymous"], ["To", "+15555550100"]])?.from).toBeNull();
  });

  it("refuse a missing or malformed call ID or dialled number", () => {
    expect(parseVoiceRequest([["From", "+1555"], ["To", "+15555550100"]])).toBeNull();
    expect(parseVoiceRequest([["CallSid", "CA1"], ["To", "+15555550100"]])).toBeNull();
    expect(parseVoiceRequest([["CallSid", SID], ["To", "<x>"]])).toBeNull();
    expect(parseVoiceRequest([["CallSid", SID]])).toBeNull();
  });

  it("refuse a repeated field, an oversized field, too many fields and malformed digits", () => {
    expect(parseVoiceRequest([...base, ["To", "+15555550101"]])).toBeNull();
    expect(parseVoiceRequest([...base, ["SpeechResult", "x".repeat(1001)]])).toBeNull();
    expect(parseVoiceRequest([...base, ["Blob", "x".repeat(4097)]])).toBeNull();
    expect(parseVoiceRequest([...base, ...Array.from({ length: 100 }, (_, index): [string, string] => [`F${index}`, "1"])])).toBeNull();
    expect(parseVoiceRequest([...base, ["Digits", "1; drop table"]])).toBeNull();
  });

  it("read an unknown status as none", () => {
    expect(parseVoiceRequest([...base, ["CallStatus", "weird"]])?.callStatus).toBeNull();
  });
});
