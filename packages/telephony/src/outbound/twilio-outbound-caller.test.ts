import { describe, expect, it } from "vitest";

import { OutboundCallError } from "./outbound-caller.ts";
import { createTwilioOutboundCaller, type TwilioCallerConfig } from "./twilio-outbound-caller.ts";
import { fakeOutboundCaller } from "./fake-outbound-caller.ts";
import { maskNumber } from "./mask-number.ts";

const CONFIG: TwilioCallerConfig = { accountSid: `AC${"1".repeat(32)}`, authToken: "secret-token-value-0123456789abcd", from: "+15555550100" };
const SID = `CA${"2".repeat(32)}`;
const REQUEST = {
  to: "+15555550123",
  answerUrl: "https://voice.example.com/voice/shift/answer?s=abc.def",
  statusUrl: "https://voice.example.com/voice/shift/status?s=abc.def",
};

type Sent = { url: string; headers: Record<string, string>; body: URLSearchParams };

function stub(reply: { status: number; body?: unknown } | Error) {
  const sent: Sent[] = [];
  const fetchImpl = (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: new URLSearchParams(init.body) });
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({ status: reply.status, json: () => (reply.body === undefined ? Promise.reject(new Error("not json")) : Promise.resolve(reply.body)) });
  };
  return { sent, fetchImpl: fetchImpl as unknown as Parameters<typeof createTwilioOutboundCaller>[1] };
}

const failure = async (reply: Parameters<typeof stub>[0]): Promise<OutboundCallError> => {
  const { fetchImpl } = stub(reply);
  try {
    await createTwilioOutboundCaller(CONFIG, fetchImpl).placeCall(REQUEST);
  } catch (error) {
    if (error instanceof OutboundCallError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
};

describe("placing a call through Twilio", () => {
  it("posts the documented form to the account's Calls.json with basic auth and returns the sid", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID, status: "queued", to: "+15555550123" } });

    const placed = await createTwilioOutboundCaller(CONFIG, fetchImpl).placeCall(REQUEST);

    expect(placed).toEqual({ callSid: SID, status: "queued" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"1".repeat(32)}/Calls.json`);
    expect(sent[0]?.headers.authorization).toBe(`Basic ${Buffer.from(`${CONFIG.accountSid}:${CONFIG.authToken}`).toString("base64")}`);
    expect(sent[0]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = sent[0]?.body;
    expect(form?.get("To")).toBe("+15555550123");
    expect(form?.get("From")).toBe("+15555550100");
    expect(form?.get("Url")).toBe(REQUEST.answerUrl);
    expect(form?.get("Method")).toBe("POST");
    expect(form?.get("StatusCallback")).toBe(REQUEST.statusUrl);
    expect(form?.get("StatusCallbackMethod")).toBe("POST");
    expect(form?.getAll("StatusCallbackEvent")).toEqual(["answered", "completed"]);
    expect(form?.get("Timeout")).toBe("25");
    expect(form?.get("MachineDetection")).toBe("Enable");
    expect(form?.get("MachineDetectionTimeout")).toBe("8");
    expect(form?.has("AsyncAmd")).toBe(false);
  });

  it("can ring for a chosen time and leave machine detection off", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID, status: "queued" } });
    await createTwilioOutboundCaller(CONFIG, fetchImpl).placeCall({ ...REQUEST, ringSeconds: 40, detectMachine: false });
    expect(sent[0]?.body.get("Timeout")).toBe("40");
    expect(sent[0]?.body.has("MachineDetection")).toBe(false);
  });

  it("refuses a request it can see is wrong, before anything is sent", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID, status: "queued" } });
    const caller = createTwilioOutboundCaller(CONFIG, fetchImpl);
    const bad = [
      { ...REQUEST, to: "5555550123" },
      { ...REQUEST, to: "+0555550123" },
      { ...REQUEST, to: "+1555555012345678" },
      { ...REQUEST, answerUrl: "http://voice.example.com/answer" },
      { ...REQUEST, answerUrl: "not a url" },
      { ...REQUEST, statusUrl: "https://voice_service.example.com/status" },
      { ...REQUEST, statusUrl: "https://user:pw@voice.example.com/status" },
      { ...REQUEST, answerUrl: `https://voice.example.com/${"a".repeat(2100)}` },
      { ...REQUEST, ringSeconds: 0 },
      { ...REQUEST, ringSeconds: 601 },
      { ...REQUEST, ringSeconds: 2.5 },
    ];
    for (const request of bad) {
      await expect(caller.placeCall(request), JSON.stringify(request).slice(0, 80)).rejects.toMatchObject({ reason: "invalid_request", retryable: false, mayHaveBeenPlaced: false });
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses to start with a malformed account, token or caller ID", () => {
    expect(() => createTwilioOutboundCaller({ ...CONFIG, accountSid: "AC123" })).toThrow(OutboundCallError);
    expect(() => createTwilioOutboundCaller({ ...CONFIG, authToken: "" })).toThrow(OutboundCallError);
    expect(() => createTwilioOutboundCaller({ ...CONFIG, from: "0100" })).toThrow(OutboundCallError);
  });
});

describe("when Twilio refuses or fails", () => {
  it("never retries a bad number, whichever of Twilio's codes says so", async () => {
    for (const code of [21211, 13224, 21214, 21217]) {
      const error = await failure({ status: 400, body: { status: 400, code, message: "The 'To' number +15555550123 is not a valid phone number" } });
      expect(error).toMatchObject({ reason: "bad_number", retryable: false, mayHaveBeenPlaced: false, twilioCode: code });
    }
  });

  it("never retries another refusal: a forbidden destination, an unknown account, a bad request", async () => {
    for (const status of [400, 403, 404, 405]) {
      expect(await failure({ status, body: { code: 21215 } })).toMatchObject({ reason: "refused", retryable: false, mayHaveBeenPlaced: false });
    }
  });

  it("never retries wrong credentials", async () => {
    expect(await failure({ status: 401, body: { code: 20003 } })).toMatchObject({ reason: "unauthorized", retryable: false, mayHaveBeenPlaced: false, twilioCode: 20003 });
  });

  it("may retry a concurrency limit later, and knows no call was made", async () => {
    expect(await failure({ status: 429, body: { code: 20429 } })).toMatchObject({ reason: "rate_limited", retryable: true, mayHaveBeenPlaced: false });
  });

  it("may retry a server error, but says a call may already be ringing", async () => {
    for (const status of [500, 502, 503]) {
      expect(await failure({ status, body: null })).toMatchObject({ reason: "unavailable", retryable: true, mayHaveBeenPlaced: true, twilioCode: null });
    }
  });

  it("may retry a dropped connection or a timeout, but says a call may already be ringing", async () => {
    for (const reply of [new Error("ECONNRESET"), new DOMException("timed out", "TimeoutError")]) {
      expect(await failure(reply)).toMatchObject({ reason: "network", retryable: true, mayHaveBeenPlaced: true });
    }
  });

  it("does not retry a success it cannot read, since a call may exist", async () => {
    for (const body of [undefined, null, {}, { sid: "CA1", status: "queued" }, { sid: SID, status: "teleporting" }, { sid: SID }, []]) {
      expect(await failure({ status: 201, body }), JSON.stringify(body)).toMatchObject({ reason: "bad_response", retryable: false, mayHaveBeenPlaced: true });
    }
  });

  it("puts no number, token, URL or Twilio wording in an error or its fields", async () => {
    const replies = [
      { status: 400, body: { code: 21211, message: `The 'To' number ${REQUEST.to} is not valid for ${CONFIG.authToken}` } },
      { status: 401, body: { code: 20003, message: CONFIG.authToken } },
      { status: 500, body: { message: REQUEST.answerUrl } },
      new Error(`connect failed to ${REQUEST.to} with ${CONFIG.authToken}`),
    ];
    for (const reply of replies) {
      const error = await failure(reply);
      const everything = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
      for (const secret of [REQUEST.to.slice(1), CONFIG.authToken, "voice.example.com", CONFIG.accountSid, "wording"]) expect(everything).not.toContain(secret);
    }
  });

  it("takes a non-numeric Twilio code as no code", async () => {
    expect((await failure({ status: 400, body: { code: "21211" } })).twilioCode).toBeNull();
  });
});

describe("the fake caller", () => {
  it("records each call and returns distinct sids that match Twilio's shape", async () => {
    const caller = fakeOutboundCaller();
    const first = await caller.placeCall(REQUEST);
    const second = await caller.placeCall({ ...REQUEST, to: "+15555550124" });
    expect(first.callSid).toMatch(/^CA[0-9a-f]{32}$/);
    expect(second.callSid).not.toBe(first.callSid);
    expect(caller.placed.map((each) => each.to)).toEqual(["+15555550123", "+15555550124"]);
  });

  it("fails once on request with the error it is given, and refuses a bad number like the real one", async () => {
    const caller = fakeOutboundCaller();
    caller.failNext(new OutboundCallError("network", { retryable: true, mayHaveBeenPlaced: true }));
    await expect(caller.placeCall(REQUEST)).rejects.toMatchObject({ reason: "network" });
    await expect(caller.placeCall(REQUEST)).resolves.toMatchObject({ status: "queued" });
    await expect(caller.placeCall({ ...REQUEST, to: "nope" })).rejects.toMatchObject({ reason: "bad_number", retryable: false });
    expect(caller.placed).toHaveLength(1);
  });
});

describe("masking a number for a log line", () => {
  it("keeps the ends and hides the rest, as the office line does", () => {
    expect(maskNumber("+15555550199")).toBe("+1********99");
    expect(maskNumber(null)).toBeNull();
  });
});
