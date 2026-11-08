import { twilioSignature } from "@kin/telephony";

/**
 * A stand-in for Twilio's side of the webhook contract: it signs a request the
 * way Twilio does and posts it to a running service, then reads the TwiML that
 * comes back. The integration tests and `simulate-call` place calls through it,
 * so what they prove is what the real signature check would see.
 */
export type TwilioCaller = {
  /** One signed webhook request. */
  post(path: string, fields: Readonly<Record<string, string>>, options?: { authToken?: string; sign?: boolean }): Promise<{ status: number; body: string }>;
};

export function twilioCaller(baseUrl: string, authToken: string): TwilioCaller {
  return {
    async post(path, fields, options = {}) {
      const url = baseUrl + path;
      const params = Object.entries(fields);
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (options.sign !== false) headers["x-twilio-signature"] = twilioSignature(url, params, options.authToken ?? authToken);
      const response = await fetch(url, { method: "POST", headers, body: new URLSearchParams(fields).toString() });
      return { status: response.status, body: await response.text() };
    },
  };
}

/** The address of the next turn in a TwiML answer, as a path Twilio would post to; `null` when the call is over. */
export function nextTurnPath(twiml: string, baseUrl: string): string | null {
  const action = /<Gather [^>]*action="([^"]+)"/.exec(twiml)?.[1];
  return action === undefined ? null : action.replaceAll("&amp;", "&").replace(baseUrl, "");
}

/** The sentences Kin says in a TwiML answer, in order. */
export function spokenIn(twiml: string): string[] {
  return [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((match) =>
    (match[1] ?? "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&"),
  );
}

/** Plays a whole call: the call coming in, then each of the caller's answers in turn. Returns every TwiML Kin answered with. */
export async function playCall(caller: TwilioCaller, baseUrl: string, call: { sid: string; from: string; to: string; says: readonly string[] }): Promise<string[]> {
  const base = { CallSid: call.sid, From: call.from, To: call.to, AccountSid: "AC00000000000000000000000000000000" };
  const turns: string[] = [(await caller.post("/voice/incoming", { ...base, CallStatus: "ringing" })).body];
  for (const says of call.says) {
    const path = nextTurnPath(turns.at(-1) ?? "", baseUrl);
    if (path === null) break;
    turns.push((await caller.post(path, { ...base, CallStatus: "in-progress", SpeechResult: says })).body);
  }
  return turns;
}
