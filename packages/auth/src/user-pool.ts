/** Where the user pool's own API answers, read from the token issuer. */
export type UserPool = {
  readonly region: string;
  readonly userPoolId: string;
  /** The API's origin. Cognito's is the issuer's origin; a stand-in's is its own. */
  readonly endpoint: string;
  /** False for a stand-in on this machine, which the end-to-end tests run. */
  readonly hosted: boolean;
};

const COGNITO_HOST = /^cognito-idp\.([a-z0-9-]+)\.amazonaws\.com$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const STAND_IN_REGION = "us-east-1";

/** The issuer is not a Cognito user pool, nor a stand-in on this machine. */
export class UserPoolError extends Error {
  readonly retryable = false;

  constructor() {
    super("The token issuer is not a Cognito user pool");
    this.name = "UserPoolError";
  }
}

/**
 * Cognito's issuer is `https://cognito-idp.<region>.amazonaws.com/<pool ID>`,
 * and the same origin serves the pool's API, so the issuer already says
 * where to call. No second setting can disagree with it.
 */
export function userPoolOf(issuer: string): UserPool {
  const url = new URL(issuer);
  const userPoolId = url.pathname.replace(/^\/+|\/+$/g, "");
  const region = COGNITO_HOST.exec(url.hostname)?.[1];
  if (region !== undefined && url.protocol === "https:" && /^[a-z0-9-]+_[A-Za-z0-9]+$/.test(userPoolId)) {
    return { region, userPoolId, endpoint: url.origin, hosted: true };
  }
  if (LOCAL_HOSTS.has(url.hostname)) return { region: STAND_IN_REGION, userPoolId: userPoolId === "" ? "local" : userPoolId, endpoint: url.origin, hosted: false };
  throw new UserPoolError();
}
