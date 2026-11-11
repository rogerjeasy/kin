import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

function base32Bytes(secret: string): Buffer {
  let bits = "";
  for (const char of secret.replace(/[\s=]/g, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("Not a base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(Number.parseInt(bits.slice(at, at + 8), 2));
  return Buffer.from(bytes);
}

/** The six-digit code an authenticator app shows for this secret, as RFC 6238 computes it. For the end-to-end tests only. */
export function totpCode(secret: string, at: Date = new Date(), stepOffset = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / STEP_SECONDS) + stepOffset));
  const digest = createHmac("sha1", base32Bytes(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** A fresh random secret, as Cognito's AssociateSoftwareToken returns one. */
export function newTotpSecret(random: (size: number) => Buffer): string {
  return [...random(20)].map((byte) => BASE32[byte % 32]).join("");
}
