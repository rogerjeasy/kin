import type { Authentication } from "./session.ts";

/**
 * The fresh check that approving real money needs (docs/architecture.md
 * section 12.1). Cognito's step-up asks for this level: a password and a code
 * from an authenticator app.
 */
export const STEP_UP_LEVEL = "urn:cognito:loa:4";

/** How long a sign-in counts as fresh for approving a payment. */
export const STEP_UP_WINDOW_SECONDS = 300;

/** A sign-in may claim a time slightly ahead of Kin's clock. */
const CLOCK_SKEW_SECONDS = 60;

export type StepUpVerdict =
  | { readonly fresh: true; readonly evidence: string }
  | { readonly fresh: false; readonly reason: "stale" | "no_second_factor" };

/**
 * The `amr` values Cognito sets for its level 4: a password with a code from an
 * authenticator app. `mfa` alone is not enough, because Cognito adds it for any
 * two factors, such as a password and an emailed code (level 3).
 * https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-step-up-authentication.html
 */
const AUTHENTICATOR_METHODS = ["otp", "mfa"] as const;

/**
 * Whether the person's last sign-in proves a second factor from an
 * authenticator app, completed in the last few minutes. Kin trusts only what
 * the verified ID token says. A token without the `amr` claim proves nothing,
 * so the answer is no.
 */
export function assessStepUp(authentication: Authentication, now: Date): StepUpVerdict {
  if (!AUTHENTICATOR_METHODS.every((method) => authentication.methods.includes(method))) return { fresh: false, reason: "no_second_factor" };
  if (authentication.at === null || !signedInMomentsAgo(authentication.at, now)) return { fresh: false, reason: "stale" };
  const authTime = Math.floor(authentication.at.getTime() / 1000);
  return { fresh: true, evidence: `cognito:${authentication.tokenId ?? "no-jti"}:${authTime}:${authentication.methods.join("+")}` };
}

function signedInMomentsAgo(at: Date, now: Date): boolean {
  const age = (now.getTime() - at.getTime()) / 1000;
  return age <= STEP_UP_WINDOW_SECONDS && age >= -CLOCK_SKEW_SECONDS;
}

export type EnrolmentVerdict = { readonly fresh: true } | { readonly fresh: false; readonly reason: "someone_else" | "stale" };

/**
 * Whether a sign-in may set up the account's authenticator app: the person
 * who asked, signed in again from scratch in the last few minutes. A session
 * left open, or a stolen session cookie, is not enough: it would let someone
 * else's phone become this person's second factor.
 */
export function assessEnrolmentSignIn(signedIn: { readonly userId: string; readonly authentication: Authentication }, askedBy: string, now: Date): EnrolmentVerdict {
  if (signedIn.userId !== askedBy) return { fresh: false, reason: "someone_else" };
  const { at } = signedIn.authentication;
  return at !== null && signedInMomentsAgo(at, now) ? { fresh: true } : { fresh: false, reason: "stale" };
}
