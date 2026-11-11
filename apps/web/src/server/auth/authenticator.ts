import { AUTHENTICATOR_CODE, AuthenticatorError, authenticatorUri, cognitoAuthenticator, userPoolOf, type Authenticator, type AuthenticatorErrorReason } from "@kin/auth";
import { cookies } from "next/headers";

import { qrCode, type QrCode } from "../qr-code";
import type { Viewer } from "../viewer";
import { authConfig } from "./config";
import { COOKIES } from "./cookies";

let authenticator: Authenticator | undefined;

function userPool(): Authenticator {
  authenticator ??= cognitoAuthenticator(userPoolOf(authConfig().issuer));
  return authenticator;
}

/** Where a person stands with their authenticator app, as the user pool says. */
export type AuthenticatorStatus = "demo" | "enabled" | "not_set" | "sign_in_again" | "unavailable";

/** What the set-up screen shows once: the secret, as text and as a QR code. */
export type AuthenticatorStart = { readonly ok: true; readonly secret: string; readonly qr: QrCode };
export type AuthenticatorResult = AuthenticatorStart | { readonly ok: true } | { readonly ok: false; readonly reason: AuthenticatorErrorReason | "invalid" };

async function accessToken(): Promise<string | null> {
  return (await cookies()).get(COOKIES.access)?.value ?? null;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

function failed(operation: string, error: unknown): { readonly ok: false; readonly reason: AuthenticatorErrorReason } {
  if (!(error instanceof AuthenticatorError)) throw error;
  if (error.reason === "unavailable" || error.reason === "refused") console.error(JSON.stringify({ message: `authenticator.${operation}`, error: errorName(error), reason: error.reason }));
  return { ok: false, reason: error.reason };
}

/**
 * Whether the person's account asks for an authenticator code. A visitor in
 * the demo has no account: their approvals move simulated money and need none.
 */
export async function authenticatorStatus(viewer: Viewer): Promise<AuthenticatorStatus> {
  if (viewer.kind === "visitor") return "demo";
  const token = await accessToken();
  if (token === null) return "sign_in_again";
  try {
    return (await userPool().enabled(token)) ? "enabled" : "not_set";
  } catch (error) {
    const { reason } = failed("status", error);
    return reason === "sign_in_again" ? "sign_in_again" : "unavailable";
  }
}

/**
 * Starts or confirms setting up the person's own authenticator app, with
 * their own access token: Kin holds no power over anyone's account here. An
 * app that is already set up is not replaced from Kin, so a stolen session
 * cannot swap in someone else's phone.
 */
export async function manageAuthenticator(viewer: Viewer, input: unknown): Promise<AuthenticatorResult> {
  if (viewer.kind !== "person") return { ok: false, reason: "refused" };
  if (typeof input !== "object" || input === null) return { ok: false, reason: "invalid" };
  const { operation, code } = input as Record<string, unknown>;
  const token = await accessToken();
  if (token === null) return { ok: false, reason: "sign_in_again" };
  try {
    if (operation === "begin") {
      if (await userPool().enabled(token)) return { ok: false, reason: "refused" };
      const { secret } = await userPool().begin(token);
      return { ok: true, secret, qr: qrCode(authenticatorUri(viewer.session.email, secret)) };
    }
    if (operation === "confirm") {
      if (typeof code !== "string" || !AUTHENTICATOR_CODE.test(code.trim())) return { ok: false, reason: "wrong_code" };
      await userPool().confirm(token, code.trim());
      return { ok: true };
    }
  } catch (error) {
    return failed(String(operation), error);
  }
  return { ok: false, reason: "invalid" };
}
