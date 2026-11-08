import { describe, expect, it } from "vitest";

import { callEnd, isPerson, parseShiftCallRequest } from "./shift-call-request.ts";

const BASE: [string, string][] = [
  ["CallSid", `CA${"b".repeat(32)}`],
  ["To", "+15555550123"],
  ["From", "+15555550100"],
];

describe("the answer webhook's fields", () => {
  it("reads the call, the numbers, the words and the keys, and who picked up", () => {
    const request = parseShiftCallRequest([...BASE, ["SpeechResult", "Yes."], ["Digits", "1"], ["AnsweredBy", "human"], ["CallStatus", "in-progress"]]);
    expect(request).toEqual({
      callSid: `CA${"b".repeat(32)}`,
      to: "+15555550123",
      from: "+15555550100",
      speech: "Yes.",
      digits: "1",
      callStatus: "in-progress",
      answeredBy: "human",
    });
  });

  it("reads no verdict, or one Twilio does not define, as none", () => {
    expect(parseShiftCallRequest(BASE)?.answeredBy).toBeNull();
    expect(parseShiftCallRequest([...BASE, ["AnsweredBy", "robot"]])?.answeredBy).toBeNull();
  });

  it("refuses what the office line's parser refuses", () => {
    expect(parseShiftCallRequest([["CallSid", "CA1"], ["To", "+15555550123"]])).toBeNull();
    expect(parseShiftCallRequest([...BASE, ["Digits", "<x>"]])).toBeNull();
    expect(parseShiftCallRequest([...BASE, ["To", "+15555550124"]])).toBeNull();
  });
});

describe("who is on the line", () => {
  it("counts a person, and no verdict or an unknown one, as a person; never a machine or a fax", () => {
    expect(isPerson("human")).toBe(true);
    expect(isPerson(null)).toBe(true);
    expect(isPerson("unknown")).toBe(true);
    for (const machine of ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"] as const) expect(isPerson(machine)).toBe(false);
  });
});

describe("how a call ended", () => {
  it("maps Twilio's final statuses to the domain's, and says nothing while the call is going", () => {
    expect(callEnd("completed")).toBe("completed");
    expect(callEnd("busy")).toBe("no_answer");
    expect(callEnd("no-answer")).toBe("no_answer");
    expect(callEnd("failed")).toBe("failed");
    expect(callEnd("canceled")).toBe("failed");
    for (const going of ["queued", "ringing", "in-progress", null]) expect(callEnd(going)).toBeNull();
  });
});
