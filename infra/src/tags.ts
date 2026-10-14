/** The tag that marks a resource as Kin's, for cost and for ownership. */
export const PROJECT_TAG = { key: "project", value: "kin" } as const;

export const TAGS = {
  [PROJECT_TAG.key]: PROJECT_TAG.value,
  managed_by: "cdk",
  repo: "github.com/rogerjeasy/kin",
} as const;
