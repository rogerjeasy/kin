/**
 * What Kin's web app may do to its user pool with its own AWS identity
 * (packages/auth `cognitoAdmin`): add a person to an account type group after
 * a sign-in or a renewal, and read whether they have an authenticator app.
 * Nothing that changes an attribute, a password or a second factor. The web
 * app grants the default type at the first sign-in, so there is no Lambda
 * trigger: the account's Lambda quota is small and shared (decision 40).
 */
export const POOL_ADMIN_ACTIONS = ["cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminGetUser"] as const;
