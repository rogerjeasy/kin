/**
 * The coarse kind of account a person holds, kept as a Cognito group
 * (docs/tech-stack.md section 9). What a person may do inside a circle is a
 * separate question, answered by their role in that circle.
 */
export const ACCOUNT_TYPES = [
  "family_member",
  "caregiver",
  "professional",
  "administrator",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
