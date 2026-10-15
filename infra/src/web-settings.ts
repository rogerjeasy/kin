/**
 * Where KinData leaves the settings the web app needs, for KinWeb to read by
 * name at deploy time. Parameters, not cross-stack outputs, so the two stacks
 * can be deployed, or fail, independently.
 */
export const WEB_SETTINGS = {
  authIssuer: "kin-web-auth-issuer",
  authLoginUrl: "kin-web-auth-login-url",
  authClientId: "kin-web-auth-client-id",
} as const;
