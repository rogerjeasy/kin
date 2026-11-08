import { authorize } from "@kin/auth";
import type { CircleSnapshot, ShiftRecord } from "@kin/db";
import { mayConfirmShift, type ShiftWordRefusal } from "@kin/domain";

/** Whether an active parent in the circle takes part in decisions herself, which is what decides whose word counts for a shift. */
export function parentDecides(circle: CircleSnapshot): boolean {
  return circle.members.some((member) => member.role === "parent" && member.status === "active" && member.parentLevel === "decides");
}

/**
 * Why the viewer may not give the family's word for a shift, or `null` when
 * they may. The role comes from the access table and the rest from the
 * domain's own rule, so the screen and the server boundary read the same one;
 * the database checks it a third time.
 */
export function familyWordRefusal(circle: CircleSnapshot, shift: Pick<ShiftRecord, "memberId">): ShiftWordRefusal | null {
  const { role, memberId } = circle.viewer;
  if (!authorize({ role, status: "active" }, "shift.confirm").allowed) return "role_cannot";
  return mayConfirmShift({ role, memberId, shiftMemberId: shift.memberId, parentDecides: parentDecides(circle), demo: circle.circle.demo });
}

/**
 * Whether this visit's call can be played: an aide's visit that has ended and
 * still waits for the family's word, which this viewer may give. The same test
 * the screen uses to show the button, so a button is never shown that the
 * server would refuse.
 */
export function mayHearCall(circle: CircleSnapshot, shift: ShiftRecord): boolean {
  return circle.circle.demo && shift.kind === "aide" && shift.state === "checked_out" && shift.familyConfirmedAt === null && familyWordRefusal(circle, shift) === null;
}
