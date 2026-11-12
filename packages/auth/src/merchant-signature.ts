import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How the demo pharmacy knows a request is Kin's worker's (docs/architecture.md
 * section 8.6, step 5: "Kin sends the merchant a signed instruction"). The
 * worker and the pharmacy share one secret, generated in Secrets Manager and
 * never typed. Each request carries HMAC-SHA256 over the timestamp, the
 * method, the path and the raw body, in the agency API's header shape:
 *
 *   Kin-Merchant-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<METHOD>.<path>.<raw body>")>
 *
 * The method and path are signed as well as the body, so a signed read of one
 * order cannot be replayed as a read of another, nor a read as a write. A
 * request outside the window is refused; inside it, an order is idempotent by
 * its key, so a replayed one buys nothing twice.
 */

/** How far a request's timestamp may be from the pharmacy's clock. */
export const MERCHANT_SIGNATURE_WINDOW_SECONDS = 300;

export const MERCHANT_SIGNATURE_HEADER = "kin-merchant-signature";

const SIGNATURE_SHAPE = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/u;

type SignedRequest = { readonly method: string; readonly path: string; readonly rawBody: string };

function mac(secret: string, timestampSeconds: number, request: SignedRequest): Buffer {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${request.method.toUpperCase()}.${request.path}.${request.rawBody}`, "utf8").digest();
}

/** The header the worker sends with a request. */
export function signMerchantRequest(secret: string, timestampSeconds: number, request: SignedRequest): string {
  return `t=${timestampSeconds},v1=${mac(secret, timestampSeconds, request).toString("hex")}`;
}

export type MerchantSignatureVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: "malformed" | "stale" | "mismatch" };

/**
 * Whether `header` signs exactly this method, path and body with `secret`, at
 * a time within the window around `now`. The comparison takes the same time
 * whatever the signature, so a wrong one teaches an attacker nothing.
 */
export function verifyMerchantSignature(input: SignedRequest & { readonly secret: string; readonly header: string | null; readonly now: Date }): MerchantSignatureVerdict {
  const match = input.header === null ? null : SIGNATURE_SHAPE.exec(input.header.trim());
  const [, stamp, given] = match ?? [];
  if (stamp === undefined || given === undefined) return { ok: false, reason: "malformed" };
  const timestampSeconds = Number(stamp);
  if (Math.abs(input.now.getTime() / 1000 - timestampSeconds) > MERCHANT_SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "stale" };
  return timingSafeEqual(mac(input.secret, timestampSeconds, input), Buffer.from(given, "hex")) ? { ok: true } : { ok: false, reason: "mismatch" };
}
