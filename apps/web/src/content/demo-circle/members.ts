import type { CircleRole, ParentLevel } from "@kin/domain";

import type { CircleMember } from "../circle-portraits";

export type DemoMember = { readonly id: CircleMember; readonly role: CircleRole };

/** Everyone in Rose's circle, with the one role each holds in it. */
export const demoMembers = [
  { id: "rose", role: "parent" },
  { id: "elena", role: "organizer" },
  { id: "marcus", role: "contributor" },
  { id: "ana", role: "contributor" },
  { id: "amara", role: "caregiver" },
] as const satisfies readonly DemoMember[];

/** How Rose takes part, chosen with her (docs/project-description.md section 6.1). */
export const ROSE_LEVEL: ParentLevel = "decides";

/** The member whose screens the demo shows: Elena, the organizer. */
export const VIEWER: DemoMember = { id: "elena", role: "organizer" };

export function roleOf(memberId: CircleMember): CircleRole {
  const member = demoMembers.find((each) => each.id === memberId);
  if (!member) {
    throw new Error(`${memberId} is not in Rose's circle`);
  }
  return member.role;
}
