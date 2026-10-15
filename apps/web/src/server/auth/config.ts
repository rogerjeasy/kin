import { createSessionVerifier, type SessionVerifier } from "@kin/auth";
import { readAuthConfig, type AuthConfig } from "@kin/config";

let config: AuthConfig | undefined;
let verifier: SessionVerifier | undefined;

/**
 * The sign-in settings, read from the environment the first time a request
 * needs them. Never at build time: the build must not need them.
 */
export function authConfig(): AuthConfig {
  config ??= readAuthConfig(process.env);
  return config;
}

/** One verifier per server, so the provider's signing keys are fetched once. */
export function sessionVerifier(): SessionVerifier {
  verifier ??= createSessionVerifier(authConfig());
  return verifier;
}
