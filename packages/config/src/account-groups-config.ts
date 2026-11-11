export const ACCOUNT_GROUPS_ENV = { enabled: "KIN_AUTH_ASSIGN_GROUPS" } as const;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether the web app puts people in their account type groups after they
 * sign in (packages/auth `accountTypesOwed`). It needs AWS credentials allowed
 * to change Kin's user pool, so it is on only where a deployment grants them,
 * or a test runs its own provider. Off, nobody is added to any group.
 */
export function readAccountGroupsEnabled(env: Env): boolean {
  return env[ACCOUNT_GROUPS_ENV.enabled]?.trim() === "on";
}
