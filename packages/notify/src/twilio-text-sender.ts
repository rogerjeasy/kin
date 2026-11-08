import { TextDeliveryError, isE164, type SentText, type TextMessage, type TextSender } from "./text-sender.ts";

/**
 * Twilio's Messages.create, as documented on 2026-11-08:
 * - https://www.twilio.com/docs/messaging/api/message-resource
 *   POST /2010-04-01/Accounts/{AccountSid}/Messages.json, form fields `To`,
 *   `Body` (up to 1,600 characters; split into segments of 160 GSM-7 or 70
 *   UCS-2 characters, and billed per segment), and one of `From` or
 *   `MessagingServiceSid`. Response: `sid` (SM, 32 hex) and `status`. The page
 *   names no idempotency mechanism.
 * - https://www.twilio.com/docs/usage/twilios-response
 *   JSON errors `{status, message, code, more_info}`; 201 on create; 401 bad
 *   credentials; 429 concurrency limit; 500 and 503 Twilio's own trouble.
 * - Arabic and Hebrew text is UCS-2, so such a message costs a segment per 70
 *   characters; the check-in text is kept short for that reason.
 *
 * No Twilio SDK: one POST with `fetch`. Nothing here logs, and no error carries
 * the number, the body, the token or Twilio's message text. What only a live
 * account proves: that the sender number or messaging service can text a real
 * handset in each country (A2P 10DLC registration in the US, alphanumeric sender
 * rules elsewhere), and that carriers deliver the links and the Arabic and
 * Hebrew text intact.
 */
export type TwilioTextConfig = {
  /** `AC` and 32 hex characters. */
  readonly accountSid: string;
  readonly authToken: string;
  /** Exactly one of Kin's sender number (E.164) or a Messaging Service SID (`MG` and 32 hex characters). */
  readonly sender: { readonly from: string } | { readonly messagingServiceSid: string };
};

const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
const MESSAGE_SID = /^(SM|MM)[0-9a-fA-F]{32}$/;
const API_BASE = "https://api.twilio.com/2010-04-01";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1600;

type Fetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  readonly status: number;
  json(): Promise<unknown>;
}>;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

async function twilioCodeOf(response: { json(): Promise<unknown> }): Promise<number | null> {
  try {
    const body = await response.json();
    return isObject(body) && typeof body.code === "number" && Number.isInteger(body.code) ? body.code : null;
  } catch {
    return null;
  }
}

/** 21211 and 21214: not a valid number; 21614: not a mobile number. (21610, the recipient replied STOP, is a plain refusal.) None will change on a retry. */
const BAD_NUMBER_CODES: ReadonlySet<number> = new Set([21211, 21214, 21614]);

function refusal(status: number, twilioCode: number | null): TextDeliveryError {
  if (status === 401) return new TextDeliveryError("unauthorized", { retryable: false, mayHaveBeenSent: false, twilioCode });
  if (status === 429) return new TextDeliveryError("rate_limited", { retryable: true, mayHaveBeenSent: false, twilioCode });
  if (status >= 500) return new TextDeliveryError("unavailable", { retryable: true, mayHaveBeenSent: true, twilioCode });
  const reason = twilioCode !== null && BAD_NUMBER_CODES.has(twilioCode) ? "bad_number" : "refused";
  return new TextDeliveryError(reason, { retryable: false, mayHaveBeenSent: false, twilioCode });
}

function formBody(config: TwilioTextConfig, message: TextMessage): string {
  if (!isE164(message.to)) throw new TextDeliveryError("bad_number", { retryable: false, mayHaveBeenSent: false });
  if (message.body.trim() === "" || message.body.length > MAX_BODY_CHARS) throw new TextDeliveryError("invalid_message", { retryable: false, mayHaveBeenSent: false });
  const form = new URLSearchParams({ To: message.to, Body: message.body });
  if ("from" in config.sender) form.set("From", config.sender.from);
  else form.set("MessagingServiceSid", config.sender.messagingServiceSid);
  return form.toString();
}

function readSent(body: unknown): SentText {
  if (isObject(body) && typeof body.sid === "string" && MESSAGE_SID.test(body.sid)) return { messageSid: body.sid };
  // Twilio said yes, so a message may well be on its way; it is not safe to send again.
  throw new TextDeliveryError("bad_response", { retryable: false, mayHaveBeenSent: true });
}

/** Sends text through Twilio's REST API. `fetchImpl` is for tests. */
export function createTwilioTextSender(config: TwilioTextConfig, fetchImpl: Fetch = fetch): TextSender {
  const sender = config.sender;
  const senderOk = "from" in sender ? isE164(sender.from) : MESSAGING_SERVICE_SID.test(sender.messagingServiceSid);
  if (!ACCOUNT_SID.test(config.accountSid) || config.authToken === "" || !senderOk) {
    throw new TextDeliveryError("invalid_message", { retryable: false, mayHaveBeenSent: false });
  }
  const url = `${API_BASE}/Accounts/${config.accountSid}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`, "utf8").toString("base64")}`;
  return {
    async send(message) {
      const body = formBody(config, message);
      let response: Awaited<ReturnType<Fetch>>;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new TextDeliveryError("network", { retryable: true, mayHaveBeenSent: true });
      }
      if (response.status < 200 || response.status >= 300) throw refusal(response.status, await twilioCodeOf(response));
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return readSent(parsed);
    },
  };
}
