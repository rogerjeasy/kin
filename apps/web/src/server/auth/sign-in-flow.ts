import type { SignInSecrets } from "@kin/auth";

import { safeNextPath } from "./next-path";

/** What one sign-in remembers between leaving for the provider and coming back. */
export type SignInFlow = SignInSecrets & { readonly next: string };

export function encodeFlow(flow: SignInFlow): string {
  return Buffer.from(JSON.stringify(flow)).toString("base64url");
}

/**
 * Reads the sign-in cookie, or `null` when it is missing or not one Kin wrote.
 * Where to go next is checked again here, not trusted from the cookie, so
 * no planted cookie can turn the callback into a redirect to another site.
 */
export function decodeFlow(raw: string | undefined): SignInFlow | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { verifier, state, nonce, next } = value as Record<string, unknown>;
  const texts = [verifier, state, nonce, next];
  if (!texts.every((text) => typeof text === "string" && text !== "")) return null;
  return { verifier: verifier as string, state: state as string, nonce: nonce as string, next: safeNextPath(next as string) };
}
