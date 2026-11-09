/**
 * How far a member lets their own AI assistant go, when they connect it to
 * the circle: only read the record, or also raise a proposal that waits for
 * the family's yes. Neither lets it answer, pay or sign. packages/auth decides
 * what each scope allows; the database holds the same two names.
 */
export const DELEGATION_SCOPES = ["read", "propose"] as const;

export type DelegationScope = (typeof DELEGATION_SCOPES)[number];
