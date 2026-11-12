import {
  AUTHENTICATOR_CODE,
  AuthenticatorError,
  assessEnrolmentSignIn,
  authenticatorUri,
  cognitoAuthenticator,
  revokeRefreshToken,
  userPoolOf,
  type Authenticator,
  type AuthenticatorErrorReason,
  type Session,
  type TokenSet,
} from "@kin/auth";
import { readAccountEmailConfig, readEnrolmentKey } from "@kin/config";
import { authenticatorEnrolledEmail, createGmailSender, type EmailSender } from "@kin/notify";
import { cookies } from "next/headers";

import { qrCode, type QrCode } from "../qr-code";
import type { Viewer } from "../viewer";
import { authConfig } from "./config";
import { COOKIES, clearedEnrolmentCookie, enrolmentCookie, type CookieToSet } from "./cookies";
import { ENROLMENT_SECONDS, openEnrolment, sealEnrolment, type Enrolment } from "./enrolment-seal";
import { poolAdmin } from "./pool-admin";

let authenticator: Authenticator | undefined;
let key: Buffer | null | undefined;
let mailer: EmailSender | null | undefined;

function userPool(): Authenticator {
  authenticator ??= cognitoAuthenticator(userPoolOf(authConfig().issuer));
  return authenticator;
}

function enrolmentKey(): Buffer | null {
  if (key === undefined) key = readEnrolmentKey(process.env);
  return key;
}

function accountMailer(): EmailSender | null {
  if (mailer === undefined) {
    const config = readAccountEmailConfig(process.env);
    mailer = config.enabled ? createGmailSender({ address: config.sender, appPassword: config.appPassword }) : null;
  }
  return mailer;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");
const log = (message: string, fields: Record<string, string> = {}) => console.info(JSON.stringify({ message, ...fields }));

/** Why setting up an app could not go on, as the screen says it. */
export type EnrolmentProblem = AuthenticatorErrorReason | "invalid";

/**
 * Where a person stands with their authenticator app. `pending` is a set-up
 * started by a fresh sign-in in the last ten minutes, with the key to scan.
 */
export type AuthenticatorScreen =
  | { readonly status: "demo" | "enabled" | "not_set" | "unavailable" }
  | { readonly status: "pending"; readonly secret: string; readonly qr: QrCode };

async function pendingEnrolment(userId: string): Promise<Enrolment | null> {
  const sealing = enrolmentKey();
  if (sealing === null) return null;
  const enrolment = openEnrolment(sealing, (await cookies()).get(COOKIES.enrolment)?.value, new Date());
  return enrolment?.userId === userId ? enrolment : null;
}

/**
 * What the sign-in security screen shows. The user pool is asked with the web
 * app's own identity (AdminGetUser): the person's session token cannot touch
 * their account. A visitor in the demo has no account: their approvals move
 * simulated money and need no second factor.
 */
export async function authenticatorScreen(viewer: Viewer): Promise<AuthenticatorScreen> {
  if (viewer.kind === "visitor") return { status: "demo" };
  try {
    if (await poolAdmin().authenticatorEnabled(viewer.userId)) return { status: "enabled" };
  } catch (error) {
    console.error(JSON.stringify({ message: "authenticator.status_unavailable", error: errorName(error) }));
    return { status: "unavailable" };
  }
  const pending = await pendingEnrolment(viewer.userId);
  if (pending === null) return { status: "not_set" };
  return { status: "pending", secret: pending.secret, qr: qrCode(authenticatorUri(viewer.session.email, pending.secret)) };
}

/** Whether a person may start setting up an app: they have none yet, and this server can seal the set-up. */
export async function mayStartEnrolment(userId: string): Promise<EnrolmentProblem | null> {
  if (enrolmentKey() === null) return "unavailable";
  try {
    return (await poolAdmin().authenticatorEnabled(userId)) ? "refused" : null;
  } catch (error) {
    console.error(JSON.stringify({ message: "authenticator.status_unavailable", error: errorName(error) }));
    return "unavailable";
  }
}

async function revokeQuietly(refreshToken: string | null): Promise<void> {
  if (refreshToken === null) return;
  try {
    await revokeRefreshToken(authConfig(), refreshToken);
  } catch (error) {
    // The token dies with its hour anyway; nobody outside the server ever held it.
    console.error(JSON.stringify({ message: "authenticator.revoke_failed", error: errorName(error) }));
  }
}

/**
 * The callback's half of an enrolment: the person signed in again from
 * scratch, with the one scope that can set up a second factor. Only the same
 * person, back within minutes, with no app yet, goes on. Their new tokens
 * never become the session: the access token is sealed for the next ten
 * minutes and its refresh token revoked when the set-up ends.
 */
export async function startEnrolment(session: Session, tokens: TokenSet, askedBy: string, now: Date): Promise<{ readonly cookie: CookieToSet } | { readonly problem: EnrolmentProblem }> {
  const verdict = assessEnrolmentSignIn(session, askedBy, now);
  const refuse = async (problem: EnrolmentProblem) => {
    await revokeQuietly(tokens.refreshToken);
    return { problem };
  };
  if (!verdict.fresh) return refuse(verdict.reason === "someone_else" ? "refused" : "sign_in_again");
  const blocked = await mayStartEnrolment(session.userId);
  const sealing = enrolmentKey();
  if (blocked !== null || sealing === null) return refuse(blocked ?? "unavailable");
  try {
    const { secret } = await userPool().begin(tokens.accessToken);
    const sealed = sealEnrolment(sealing, { userId: session.userId, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, secret, startedAt: now.getTime() });
    log("authenticator.enrolment_started");
    return { cookie: enrolmentCookie(sealed, ENROLMENT_SECONDS) };
  } catch (error) {
    if (!(error instanceof AuthenticatorError)) throw error;
    console.error(JSON.stringify({ message: "authenticator.begin_failed", reason: error.reason }));
    return refuse(error.reason);
  }
}

export type ConfirmResult = { readonly ok: true } | { readonly ok: false; readonly reason: EnrolmentProblem };

/**
 * The screen's half: a code from the app proves it works, and it becomes the
 * account's second factor. Then the enrolment's token is revoked, the sealed
 * cookie cleared, and the person emailed that it happened, so a set-up they
 * did not make cannot pass unseen.
 */
export async function confirmEnrolment(viewer: Viewer, input: unknown, locale: string): Promise<{ readonly result: ConfirmResult; readonly cookies: readonly CookieToSet[] }> {
  if (viewer.kind !== "person") return { result: { ok: false, reason: "refused" }, cookies: [] };
  const code = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["code"] : undefined;
  if (typeof code !== "string" || !AUTHENTICATOR_CODE.test(code.trim())) return { result: { ok: false, reason: "wrong_code" }, cookies: [] };
  const enrolment = await pendingEnrolment(viewer.userId);
  if (enrolment === null) return { result: { ok: false, reason: "sign_in_again" }, cookies: [clearedEnrolmentCookie()] };
  try {
    await userPool().confirm(enrolment.accessToken, code.trim());
  } catch (error) {
    if (!(error instanceof AuthenticatorError)) throw error;
    const over = error.reason === "sign_in_again" || error.reason === "refused";
    if (over) await revokeQuietly(enrolment.refreshToken);
    return { result: { ok: false, reason: error.reason }, cookies: over ? [clearedEnrolmentCookie()] : [] };
  }
  await revokeQuietly(enrolment.refreshToken);
  log("authenticator.enrolled");
  await tellThePerson(viewer.session.email, locale);
  return { result: { ok: true }, cookies: [clearedEnrolmentCookie()] };
}

async function tellThePerson(email: string, locale: string): Promise<void> {
  const sender = accountMailer();
  if (sender === null) {
    log("authenticator.notice_not_configured");
    return;
  }
  try {
    await sender.send({ to: email, ...authenticatorEnrolledEmail(locale) });
    log("authenticator.notice_sent");
  } catch (error) {
    // The app is set up either way; the failure is reported, not hidden.
    console.error(JSON.stringify({ message: "authenticator.notice_failed", error: errorName(error) }));
  }
}
