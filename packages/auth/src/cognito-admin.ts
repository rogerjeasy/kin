import { AdminAddUserToGroupCommand, AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

import { GRANTABLE_ACCOUNT_TYPES, type GrantableAccountType } from "./account-groups.ts";
import type { UserPool } from "./user-pool.ts";

/**
 * What the web app may do to Kin's user pool with its own AWS identity: add
 * a person to an account type group, and read whether their account has an
 * authenticator app. Its IAM policy names these two actions on this one pool.
 */
export type CognitoAdmin = {
  grant(username: string, type: GrantableAccountType): Promise<void>;
  authenticatorEnabled(username: string): Promise<boolean>;
};

/** What the adapter needs of the SDK client, so a test can stand in for it. */
export type AdminClient = { send(command: AdminAddUserToGroupCommand | AdminGetUserCommand): Promise<unknown> };

/** A type that is not one Kin grants was asked for. A cast cannot get past this. */
export class UngrantableAccountTypeError extends Error {
  readonly retryable = false;

  constructor() {
    super("Kin grants only the default and caregiver account types");
    this.name = "UngrantableAccountTypeError";
  }
}

const TIMEOUT_MS = 5_000;

/**
 * Adding a person to a group they are in already succeeds, so a retry is
 * safe. IAM cannot limit which group, so this code names the only two.
 */
export function cognitoAdmin(pool: UserPool, client: AdminClient = sdkClient(pool)): CognitoAdmin {
  return {
    async grant(username, type) {
      if (!(GRANTABLE_ACCOUNT_TYPES as readonly string[]).includes(type)) throw new UngrantableAccountTypeError();
      await client.send(new AdminAddUserToGroupCommand({ UserPoolId: pool.userPoolId, Username: username, GroupName: type }));
    },
    async authenticatorEnabled(username) {
      const user = (await client.send(new AdminGetUserCommand({ UserPoolId: pool.userPoolId, Username: username }))) as { UserMFASettingList?: unknown };
      return Array.isArray(user.UserMFASettingList) && user.UserMFASettingList.includes("SOFTWARE_TOKEN_MFA");
    },
  };
}

function sdkClient(pool: UserPool): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: pool.region,
    // Cognito's own endpoint for its region, unless a stand-in answers on this
    // machine: it is never sent the developer's real AWS credentials.
    ...(pool.hosted ? {} : { endpoint: pool.endpoint, credentials: { accessKeyId: "stand-in", secretAccessKey: "stand-in" } }),
    requestHandler: { requestTimeout: TIMEOUT_MS, connectionTimeout: TIMEOUT_MS },
    maxAttempts: 2,
  });
}
