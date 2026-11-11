import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

import { GRANTABLE_ACCOUNT_TYPES, type GrantableAccountType } from "./account-groups.ts";
import type { UserPool } from "./user-pool.ts";

/** Puts a person in an account type's group. The only write Kin makes to its user pool. */
export type AccountGroups = {
  grant(username: string, type: GrantableAccountType): Promise<void>;
};

/** What the adapter needs of the SDK client: one call, so a test can stand in for it. */
export type GroupClient = { send(command: AdminAddUserToGroupCommand): Promise<unknown> };

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
 * Adds people to account type groups with the caller's AWS identity: the web
 * app's instance role, or the sign-up function's. Their IAM policy names the
 * one user pool; this code names the only groups. Adding a person to a group
 * they are in already succeeds, so a retry is safe.
 */
export function cognitoAccountGroups(pool: UserPool, client: GroupClient = sdkClient(pool)): AccountGroups {
  return {
    async grant(username, type) {
      if (!(GRANTABLE_ACCOUNT_TYPES as readonly string[]).includes(type)) throw new UngrantableAccountTypeError();
      await client.send(new AdminAddUserToGroupCommand({ UserPoolId: pool.userPoolId, Username: username, GroupName: type }));
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
