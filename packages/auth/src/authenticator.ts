import type { Fetch } from "./oauth.ts";
import type { UserPool } from "./user-pool.ts";

/**
 * Why setting up an authenticator app failed, and what the person can do:
 * sign in again (their session cannot change their account), type the code
 * again, wait, or try later.
 */
export type AuthenticatorErrorReason = "sign_in_again" | "wrong_code" | "too_many_tries" | "unavailable" | "refused";

export class AuthenticatorError extends Error {
  readonly reason: AuthenticatorErrorReason;
  readonly retryable: boolean;

  constructor(reason: AuthenticatorErrorReason, message: string) {
    super(message);
    this.name = "AuthenticatorError";
    this.reason = reason;
    this.retryable = reason === "unavailable" || reason === "too_many_tries";
  }
}

/**
 * A person's own authenticator app, set up with their own access token. The
 * user pool lets a token change only its own person, and only when it carries
 * the `aws.cognito.signin.user.admin` scope.
 */
export type Authenticator = {
  /** Whether the person's account already asks for a code from an authenticator app. */
  enabled(accessToken: string): Promise<boolean>;
  /** Starts setting one up, and returns the secret the app needs. Nothing changes until `confirm`. */
  begin(accessToken: string): Promise<{ readonly secret: string }>;
  /** Proves the app works with one of its codes, and makes it the account's second factor. */
  confirm(accessToken: string, code: string): Promise<void>;
};

/** Six digits, as every authenticator app shows them. */
export const AUTHENTICATOR_CODE = /^\d{6}$/;
const SECRET = /^[A-Z2-7]{16,128}$/;
const TIMEOUT_MS = 8_000;
const ISSUER_LABEL = "Kin";

const SIGN_IN_AGAIN = new Set(["NotAuthorizedException", "PasswordResetRequiredException", "UserNotConfirmedException", "UserNotFoundException"]);
const WRONG_CODE = new Set(["EnableSoftwareTokenMFAException", "CodeMismatchException", "ExpiredCodeException"]);
const TOO_MANY = new Set(["LimitExceededException", "TooManyRequestsException", "TooManyFailedAttemptsException"]);

export function cognitoAuthenticator(pool: UserPool, fetcher: Fetch = fetch): Authenticator {
  const call = (operation: string, body: Record<string, unknown>) => userPoolCall(pool, fetcher, operation, body);
  return {
    async enabled(accessToken) {
      const user = await call("GetUser", { AccessToken: accessToken });
      const list = user["UserMFASettingList"];
      return Array.isArray(list) && list.includes("SOFTWARE_TOKEN_MFA");
    },
    async begin(accessToken) {
      const answer = await call("AssociateSoftwareToken", { AccessToken: accessToken });
      const secret = answer["SecretCode"];
      if (typeof secret !== "string" || !SECRET.test(secret)) throw new AuthenticatorError("refused", "The user pool returned no usable secret");
      return { secret };
    },
    async confirm(accessToken, code) {
      if (!AUTHENTICATOR_CODE.test(code)) throw new AuthenticatorError("wrong_code", "An authenticator code is six digits");
      const verified = await call("VerifySoftwareToken", { AccessToken: accessToken, UserCode: code, FriendlyDeviceName: ISSUER_LABEL });
      if (verified["Status"] !== "SUCCESS") throw new AuthenticatorError("wrong_code", "The user pool did not accept the code");
      await call("SetUserMFAPreference", { AccessToken: accessToken, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
    },
  };
}

/**
 * The address an authenticator app reads from the QR code: Kin's name, the
 * person's email so they can tell accounts apart, and the secret.
 */
export function authenticatorUri(email: string, secret: string): string {
  const label = encodeURIComponent(`${ISSUER_LABEL}:${email}`);
  return `otpauth://totp/${label}?${new URLSearchParams({ secret, issuer: ISSUER_LABEL }).toString()}`;
}

/**
 * One call to the user pool's own API, authorized by the person's access
 * token rather than an AWS signature. The provider's message is never
 * passed on: it can echo what was sent.
 */
async function userPoolCall(pool: UserPool, fetcher: Fetch, operation: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(`${pool.endpoint}/`, {
      method: "POST",
      headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${operation}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AuthenticatorError("unavailable", `The user pool could not be reached for ${operation}`);
  }
  const payload: unknown = await response.json().catch(() => null);
  const fields = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (response.ok) return fields;
  if (response.status >= 500) throw new AuthenticatorError("unavailable", `The user pool failed ${operation} with status ${response.status}`);
  const type = typeof fields["__type"] === "string" ? (fields["__type"].split("#").pop() ?? "") : "";
  const reason: AuthenticatorErrorReason = SIGN_IN_AGAIN.has(type) ? "sign_in_again" : WRONG_CODE.has(type) ? "wrong_code" : TOO_MANY.has(type) ? "too_many_tries" : "refused";
  throw new AuthenticatorError(reason, `The user pool refused ${operation}: ${type || response.status}`);
}
