import { describe, expect, it } from "vitest";

import { fakeTextSender } from "./fake-text-sender.ts";
import { TextDeliveryError, isE164 } from "./text-sender.ts";
import { createTwilioTextSender, type TwilioTextConfig } from "./twilio-text-sender.ts";

const CONFIG: TwilioTextConfig = { accountSid: `AC${"1".repeat(32)}`, authToken: "secret-token-value-0123456789abcd", sender: { from: "+15555550100" } };
const SID = `SM${"3".repeat(32)}`;
const MESSAGE = { to: "+15555550123", body: "Kin, your family’s care app.\nAmara, tap to check in to your shift at 2:00 PM: https://kin.example.com/c/x" };

type Sent = { url: string; headers: Record<string, string>; body: URLSearchParams };

function stub(reply: { status: number; body?: unknown } | Error) {
  const sent: Sent[] = [];
  const fetchImpl = (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: new URLSearchParams(init.body) });
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({ status: reply.status, json: () => (reply.body === undefined ? Promise.reject(new Error("not json")) : Promise.resolve(reply.body)) });
  };
  return { sent, fetchImpl: fetchImpl as unknown as Parameters<typeof createTwilioTextSender>[1] };
}

const failure = async (reply: Parameters<typeof stub>[0], message = MESSAGE): Promise<TextDeliveryError> => {
  const { fetchImpl } = stub(reply);
  try {
    await createTwilioTextSender(CONFIG, fetchImpl).send(message);
  } catch (error) {
    if (error instanceof TextDeliveryError) return error;
    throw error;
  }
  throw new Error("expected the text to fail");
};

describe("sending a text through Twilio", () => {
  it("posts the documented form to the account's Messages.json with basic auth and returns the sid", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID, status: "queued" } });

    const result = await createTwilioTextSender(CONFIG, fetchImpl).send(MESSAGE);

    expect(result).toEqual({ messageSid: SID });
    expect(sent[0]?.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"1".repeat(32)}/Messages.json`);
    expect(sent[0]?.headers.authorization).toBe(`Basic ${Buffer.from(`${CONFIG.accountSid}:${CONFIG.authToken}`).toString("base64")}`);
    expect(sent[0]?.body.get("To")).toBe("+15555550123");
    expect(sent[0]?.body.get("From")).toBe("+15555550100");
    expect(sent[0]?.body.get("Body")).toBe(MESSAGE.body);
    expect(sent[0]?.body.has("MessagingServiceSid")).toBe(false);
  });

  it("can send through a messaging service instead of a number", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID, status: "accepted" } });
    await createTwilioTextSender({ ...CONFIG, sender: { messagingServiceSid: `MG${"4".repeat(32)}` } }, fetchImpl).send(MESSAGE);
    expect(sent[0]?.body.get("MessagingServiceSid")).toBe(`MG${"4".repeat(32)}`);
    expect(sent[0]?.body.has("From")).toBe(false);
  });

  it("sends Arabic and Hebrew text as it is", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID, status: "queued" } });
    const body = "Kin، تطبيق رعاية عائلتك.\n⁨جان⁩، اضغط";
    await createTwilioTextSender(CONFIG, fetchImpl).send({ ...MESSAGE, body });
    expect(sent[0]?.body.get("Body")).toBe(body);
  });

  it("validates the number as E.164 at the boundary, before anything is sent", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID } });
    const sender = createTwilioTextSender(CONFIG, fetchImpl);
    for (const to of ["", "5555550123", "+0555550123", "+1 555 555 0123", "+15555550123; DROP", "+1555555012345678", "+123456"]) {
      await expect(sender.send({ ...MESSAGE, to }), to).rejects.toMatchObject({ reason: "bad_number", retryable: false, mayHaveBeenSent: false });
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses an empty body and one past Twilio's 1,600 characters", async () => {
    const { sent, fetchImpl } = stub({ status: 201, body: { sid: SID } });
    const sender = createTwilioTextSender(CONFIG, fetchImpl);
    for (const body of ["", "   \n", "x".repeat(1601)]) await expect(sender.send({ ...MESSAGE, body })).rejects.toMatchObject({ reason: "invalid_message", retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("refuses to start with a malformed account, token or sender", () => {
    expect(() => createTwilioTextSender({ ...CONFIG, accountSid: "AC1" })).toThrow(TextDeliveryError);
    expect(() => createTwilioTextSender({ ...CONFIG, authToken: "" })).toThrow(TextDeliveryError);
    expect(() => createTwilioTextSender({ ...CONFIG, sender: { from: "0100" } })).toThrow(TextDeliveryError);
    expect(() => createTwilioTextSender({ ...CONFIG, sender: { messagingServiceSid: "MG1" } })).toThrow(TextDeliveryError);
  });
});

describe("when Twilio refuses or fails", () => {
  it("never retries a bad number or a number that cannot receive text", async () => {
    for (const code of [21211, 21214, 21614]) expect(await failure({ status: 400, body: { code } })).toMatchObject({ reason: "bad_number", retryable: false, mayHaveBeenSent: false, twilioCode: code });
  });

  it("never retries a blocked recipient or another refusal", async () => {
    for (const code of [21610, 21408, 21612]) expect(await failure({ status: 400, body: { code } })).toMatchObject({ reason: "refused", retryable: false, mayHaveBeenSent: false, twilioCode: code });
    expect(await failure({ status: 403, body: null })).toMatchObject({ reason: "refused", retryable: false });
  });

  it("never retries wrong credentials", async () => {
    expect(await failure({ status: 401, body: { code: 20003 } })).toMatchObject({ reason: "unauthorized", retryable: false, mayHaveBeenSent: false });
  });

  it("may retry a concurrency limit, knowing nothing was sent", async () => {
    expect(await failure({ status: 429, body: { code: 20429 } })).toMatchObject({ reason: "rate_limited", retryable: true, mayHaveBeenSent: false });
  });

  it("may retry a server error or a dropped connection, but says the text may already be on its way", async () => {
    for (const status of [500, 503]) expect(await failure({ status, body: null })).toMatchObject({ reason: "unavailable", retryable: true, mayHaveBeenSent: true });
    for (const reply of [new Error("ECONNRESET"), new DOMException("timed out", "TimeoutError")]) {
      expect(await failure(reply)).toMatchObject({ reason: "network", retryable: true, mayHaveBeenSent: true });
    }
  });

  it("does not retry a success it cannot read, since a text may exist", async () => {
    for (const body of [undefined, null, {}, { sid: "SM1" }, { sid: `CA${"1".repeat(32)}` }, []]) {
      expect(await failure({ status: 201, body }), JSON.stringify(body)).toMatchObject({ reason: "bad_response", retryable: false, mayHaveBeenSent: true });
    }
  });

  it("puts no number, body, token or Twilio wording in an error or its fields", async () => {
    const replies = [
      { status: 400, body: { code: 21211, message: `The 'To' number ${MESSAGE.to} is not valid, ${CONFIG.authToken}` } },
      { status: 500, body: { message: MESSAGE.body } },
      new Error(`failed to ${MESSAGE.to} with ${CONFIG.authToken}: ${MESSAGE.body}`),
    ];
    for (const reply of replies) {
      const error = await failure(reply);
      const everything = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
      for (const secret of [MESSAGE.to.slice(1), CONFIG.authToken, "tap to check in", CONFIG.accountSid, "is not valid"]) expect(everything).not.toContain(secret);
    }
  });
});

describe("the fake sender", () => {
  it("records each message and returns distinct sids", async () => {
    const sender = fakeTextSender();
    const first = await sender.send(MESSAGE);
    const second = await sender.send({ ...MESSAGE, to: "+15555550124" });
    expect(first.messageSid).toMatch(/^SM[0-9a-f]{32}$/);
    expect(second.messageSid).not.toBe(first.messageSid);
    expect(sender.sent).toHaveLength(2);
  });

  it("fails once on request, and refuses a bad number like the real one", async () => {
    const sender = fakeTextSender();
    sender.failNext(new TextDeliveryError("network", { retryable: true, mayHaveBeenSent: true }));
    await expect(sender.send(MESSAGE)).rejects.toMatchObject({ reason: "network" });
    await expect(sender.send({ ...MESSAGE, to: "nope" })).rejects.toMatchObject({ reason: "bad_number" });
    await expect(sender.send(MESSAGE)).resolves.toBeDefined();
    expect(sender.sent).toHaveLength(1);
  });
});

describe("phone numbers", () => {
  it("are E.164 or nothing", () => {
    expect(isE164("+15555550123")).toBe(true);
    expect(isE164("+4915112345678")).toBe(true);
    for (const bad of ["15555550123", "+0123456789", "+12", "+1555 555", "+1555555501234567", "+١٢٣٤٥٦٧٨"]) expect(isE164(bad), bad).toBe(false);
  });
});
