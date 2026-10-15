/** Why signing in or refreshing a session failed, and whether trying again can help. */
export type AuthErrorReason =
  /** The identity provider refused the code or the refresh token. Sign in again. */
  | "rejected"
  /** The identity provider answered with something Kin cannot read. */
  | "malformed_response"
  /** The identity provider could not be reached or failed. Trying again can help. */
  | "unavailable";

export class AuthError extends Error {
  readonly reason: AuthErrorReason;
  readonly retryable: boolean;

  constructor(reason: AuthErrorReason, message: string) {
    super(message);
    this.name = "AuthError";
    this.reason = reason;
    this.retryable = reason === "unavailable";
  }
}
