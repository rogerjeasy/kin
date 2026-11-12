import { userPoolOf } from "@kin/auth";
import { cognitoAdmin, type CognitoAdmin } from "@kin/auth/cognito-admin";

import { authConfig } from "./config";

let admin: CognitoAdmin | undefined;

/** Kin's user pool as the web app's own AWS identity reaches it: two actions, this pool only. */
export function poolAdmin(): CognitoAdmin {
  admin ??= cognitoAdmin(userPoolOf(authConfig().issuer));
  return admin;
}
