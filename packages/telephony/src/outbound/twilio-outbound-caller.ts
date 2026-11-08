import { E164 } from "./mask-number.ts";
import { CALL_STATUSES, OutboundCallError, type CallStatus, type OutboundCaller, type PlaceCallRequest, type PlacedCall } from "./outbound-caller.ts";

/**
 * Twilio's Calls.create, as documented on 2026-11-08:
 * - Endpoint and fields: https://www.twilio.com/docs/voice/api/call-resource
 *   POST /2010-04-01/Accounts/{AccountSid}/Calls.json, form fields `To`,
 *   `From`, `Url` (TwiML fetched on connect), `Method`, `StatusCallback`,
 *   `StatusCallbackEvent` (repeated: initiated, ringing, answered, completed),
 *   `StatusCallbackMethod`, `Timeout` (seconds, default 60, max 600),
 *   `MachineDetection` (Enable | DetectMessageEnd) and `MachineDetectionTimeout`
 *   (seconds, default 30). Response: `sid` (CA + 32 hex) and `status`.
 * - Answering machine detection: https://www.twilio.com/docs/voice/answering-machine-detection
 *   With `Enable` and no `AsyncAmd`, Twilio waits for the decision and sends it
 *   as `AnsweredBy` (human, machine_start, fax, unknown) to the `Url` request.
 * - Errors and status codes: https://www.twilio.com/docs/usage/twilios-response
 *   JSON body `{status, message, code, more_info}`; 201 on create; 401 bad
 *   credentials; 429 concurrency limit; 500 and 503 Twilio's own trouble.
 * - Basic auth with the account SID and auth token is the documented fallback
 *   to an API key; the same token already signs the webhooks Kin verifies.
 * - Calls per second are limited (1 by default), and calls above it queue at
 *   Twilio, so a burst is slow, not refused.
 *
 * No Twilio SDK: one POST with `fetch`. What no stand-in can prove is that
 * Twilio accepts these values for a real account and number; the list of what
 * only a live account proves is in shift-call/shift-call-twiml.ts.
 */

export type TwilioCallerConfig = {
  /** `AC` and 32 hex characters. */
  readonly accountSid: string;
  readonly authToken: string;
  /** Kin's own Twilio number, in E.164 form. The caller ID the parent sees. */
  readonly from: string;
};

const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const CALL_SID = /^CA[0-9a-fA-F]{32}$/;
const API_BASE = "https://api.twilio.com/2010-04-01";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RING_SECONDS = 25;
const MIN_RING_SECONDS = 5;
const MAX_RING_SECONDS = 120;
/** Twilio's own default is 30. A parent should not wait that long in silence after picking up. */
const MACHINE_DETECTION_SECONDS = 8;
const MAX_URL_CHARS = 2000;

type Fetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  readonly status: number;
  json(): Promise<unknown>;
}>;

/** Twilio fetches these from the internet, and they carry a sealed token: plain HTTP would expose it, and its hostnames may not hold underscores. */
function checkedUrl(text: string): string {
  const invalid = () => new OutboundCallError("invalid_request", { retryable: false, mayHaveBeenPlaced: false });
  if (text.length > MAX_URL_CHARS) throw invalid();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid();
  }
  if (url.protocol !== "https:" || url.hostname.includes("_") || url.username !== "" || url.password !== "") throw invalid();
  return url.toString();
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

async function twilioCodeOf(response: { json(): Promise<unknown> }): Promise<number | null> {
  try {
    const body = await response.json();
    return isObject(body) && typeof body.code === "number" && Number.isInteger(body.code) ? body.code : null;
  } catch {
    return null;
  }
}

/** Twilio's refusals by status: what each means for a retry. */
function refusal(status: number, twilioCode: number | null): OutboundCallError {
  if (status === 401) return new OutboundCallError("unauthorized", { retryable: false, mayHaveBeenPlaced: false, twilioCode });
  if (status === 429) return new OutboundCallError("rate_limited", { retryable: true, mayHaveBeenPlaced: false, twilioCode });
  if (status >= 500) return new OutboundCallError("unavailable", { retryable: true, mayHaveBeenPlaced: true, twilioCode });
  // 21211 and 13224 are the "not a valid number" errors; other 4xx are a request Twilio will never accept.
  const badNumber = twilioCode === 21211 || twilioCode === 13224 || twilioCode === 21214 || twilioCode === 21217;
  return new OutboundCallError(badNumber ? "bad_number" : "refused", { retryable: false, mayHaveBeenPlaced: false, twilioCode });
}

function formBody(config: TwilioCallerConfig, request: PlaceCallRequest): string {
  const ring = request.ringSeconds ?? DEFAULT_RING_SECONDS;
  if (!Number.isInteger(ring) || ring < MIN_RING_SECONDS || ring > MAX_RING_SECONDS || !E164.test(request.to)) {
    throw new OutboundCallError("invalid_request", { retryable: false, mayHaveBeenPlaced: false });
  }
  const form = new URLSearchParams({
    To: request.to,
    From: config.from,
    Url: checkedUrl(request.answerUrl),
    Method: "POST",
    StatusCallback: checkedUrl(request.statusUrl),
    StatusCallbackMethod: "POST",
    Timeout: String(ring),
  });
  // `answered` says a person picked up; `completed` also carries busy, no-answer and failed.
  form.append("StatusCallbackEvent", "answered");
  form.append("StatusCallbackEvent", "completed");
  if (request.detectMachine ?? true) {
    form.set("MachineDetection", "Enable");
    form.set("MachineDetectionTimeout", String(MACHINE_DETECTION_SECONDS));
  }
  return form.toString();
}

function readPlaced(body: unknown): PlacedCall {
  if (isObject(body) && typeof body.sid === "string" && CALL_SID.test(body.sid) && typeof body.status === "string") {
    const status = body.status;
    if ((CALL_STATUSES as readonly string[]).includes(status)) return { callSid: body.sid, status: status as CallStatus };
  }
  // Twilio said yes, so a call may well exist; it is not safe to try again.
  throw new OutboundCallError("bad_response", { retryable: false, mayHaveBeenPlaced: true });
}

/**
 * Places calls through Twilio's REST API. `fetchImpl` is for tests; nothing in
 * this module logs, and no error it throws carries the number, the token or
 * Twilio's message text.
 */
export function createTwilioOutboundCaller(config: TwilioCallerConfig, fetchImpl: Fetch = fetch): OutboundCaller {
  if (!ACCOUNT_SID.test(config.accountSid) || config.authToken === "" || !E164.test(config.from)) {
    throw new OutboundCallError("invalid_request", { retryable: false, mayHaveBeenPlaced: false });
  }
  const url = `${API_BASE}/Accounts/${config.accountSid}/Calls.json`;
  const authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`, "utf8").toString("base64")}`;
  return {
    async placeCall(request) {
      const body = formBody(config, request);
      let response: Awaited<ReturnType<Fetch>>;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // A timeout or a dropped connection after the request was sent leaves it unknown whether Twilio took it.
        throw new OutboundCallError("network", { retryable: true, mayHaveBeenPlaced: true });
      }
      if (response.status < 200 || response.status >= 300) throw refusal(response.status, await twilioCodeOf(response));
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return readPlaced(parsed);
    },
  };
}
