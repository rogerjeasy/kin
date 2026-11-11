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
  if (authentication.at === null) return { fresh: false, reason: "stale" };
  const age = (now.getTime() - authentication.at.getTime()) / 1000;
  if (age > STEP_UP_WINDOW_SECONDS || age < -CLOCK_SKEW_SECONDS) return { fresh: false, reason: "stale" };
  const authTime = Math.floor(authentication.at.getTime() / 1000);
  return { fresh: true, evidence: `cognito:${authentication.tokenId ?? "no-jti"}:${authTime}:${authentication.methods.join("+")}` };
}
