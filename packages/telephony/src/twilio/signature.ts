import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The name of the header Twilio signs each webhook request with. */
export const TWILIO_SIGNATURE_HEADER = "x-twilio-signature";

export type FormParams = readonly (readonly [string, string])[];

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Twilio's request signature: the full URL Twilio called, followed by every
 * POST parameter as name and value, sorted by name, signed with HMAC-SHA1
 * under the account's auth token and written in base64.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(url: string, params: FormParams, authToken: string): string {
  const sorted = params.toSorted(([a, aValue], [b, bValue]) => compare(a, b) || compare(aValue, bValue));
  const signed = url + sorted.map(([name, value]) => name + value).join("");
  return createHmac("sha1", authToken).update(signed, "utf8").digest("base64");
}

/**
 * Whether a request carries Twilio's signature for this URL and these
 * parameters. A missing header, a wrong token and a changed parameter all
 * answer `false`. Both sides are hashed first, so the comparison takes the same
 * time whatever the header holds and whatever its length.
 */
export function verifyTwilioSignature(input: { url: string; params: FormParams; header: string | undefined; authToken: string }): boolean {
  if (input.header === undefined || input.header === "") return false;
  const expected = createHash("sha256").update(twilioSignature(input.url, input.params, input.authToken)).digest();
  const given = createHash("sha256").update(input.header).digest();
  return timingSafeEqual(expected, given);
}
