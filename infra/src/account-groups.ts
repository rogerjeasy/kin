/**
 * The one change to the user pool that Kin's code makes: adding a person to
 * an account type group. The web app does it after a sign-in or a renewal
 * (packages/auth `accountTypesOwed`), so a new account has its default type
 * from its first visit, with no Lambda trigger: the account's Lambda quota is
 * small and shared (docs/architecture.md decision 40).
 */
export const ADD_TO_GROUP = "cognito-idp:AdminAddUserToGroup";
