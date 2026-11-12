import type { ParentLevel } from "@kin/domain";
import type { CircleSnapshot, MemberRecord } from "@kin/db";

/** The parent the circle cares for, if they are a member. */
export function parentOf(circle: CircleSnapshot): MemberRecord | null {
  return circle.members.find((member) => member.role === "parent" && member.status === "active") ?? null;
}

/** The parent's name, or the circle's when the parent is not a member, for copy that names them. */
export function parentNameOf(circle: CircleSnapshot): string {
  return parentOf(circle)?.displayName ?? circle.circle.name;
}

/**
 * How the parent takes part. A circle whose parent is not a member is
 * represented: the family decides for them.
 */
export function parentLevelOf(circle: CircleSnapshot): ParentLevel {
  return parentOf(circle)?.parentLevel ?? "represented";
}

/**
 * The parent seat an organizer made when starting a real circle, while nobody
 * signed in holds it: a parent's invitation must say whether she takes it.
 * The database decides; this only offers the choice.
 */
export function unclaimedParentSeat(circle: CircleSnapshot): MemberRecord | null {
  if (circle.circle.demo) return null;
  return circle.members.find((member) => member.role === "parent" && member.status === "active" && !member.claimed) ?? null;
}

/** The active members, in the order they joined. */
export function activeMembers(circle: CircleSnapshot): MemberRecord[] {
  return circle.members.filter((member) => member.status === "active");
}
