/**
 * Where KinData leaves the settings the web app needs, for KinWeb to read by
 * name at deploy time. Parameters, not cross-stack outputs, so the two stacks
 * can be deployed, or fail, independently.
 */
export const WEB_SETTINGS = {
  authIssuer: "kin-web-auth-issuer",
  authLoginUrl: "kin-web-auth-login-url",
  authClientId: "kin-web-auth-client-id",
  /** For the web app's IAM policy, which may add people to groups in this pool only. */
  authUserPoolArn: "kin-web-auth-user-pool-arn",
} as const;
