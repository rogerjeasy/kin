/**
 * What a person may do inside one circle. A person can hold a different role
 * in each circle they belong to (docs/architecture.md decision 9).
 */
export const CIRCLE_ROLES = [
  "organizer",
  "contributor",
  "parent",
  "caregiver",
  "observer",
] as const;

export type CircleRole = (typeof CIRCLE_ROLES)[number];

/**
 * How the parent takes part, chosen with the parent
 * (docs/project-description.md section 6.1).
 */
export const PARENT_LEVELS = ["decides", "informed", "represented"] as const;

export type ParentLevel = (typeof PARENT_LEVELS)[number];
