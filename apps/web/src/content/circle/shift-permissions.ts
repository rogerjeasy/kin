import type { CircleSnapshot, ShiftPermissionRecord } from "@kin/db";

import { may } from "@/server/dashboard-context";
import { excessAboveUsualLimit } from "@/server/shifts";

export type PermissionView = {
  readonly permission: ShiftPermissionRecord;
  /** How far its per-shift cap passes what the parent usually decides herself; 0 when it does not. */
  readonly aboveUsualCents: number;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canEnd: boolean;
};

/**
 * Whether the viewer may record, resume or end a standing permission for
 * shifts: the parent in their own name, or in a demo circle the organizer
 * playing the parent's spoken yes. The database refuses anyone else again.
 */
export function mayGrantShiftPermission(circle: CircleSnapshot): boolean {
  return may(circle, "shift_permission.grant") && (circle.viewer.role === "parent" || circle.circle.demo);
}

/** The circle's permissions for shifts, newest first, with what the viewer may do to each. */
export function permissionViews(circle: CircleSnapshot): PermissionView[] {
  const grants = mayGrantShiftPermission(circle);
  const pauses = may(circle, "shift_permission.pause");
  return circle.shiftPermissions
    .map((permission) => ({
      permission,
      aboveUsualCents: excessAboveUsualLimit(circle, { payeeId: permission.payeeId, maxMinutesPerDay: permission.maxMinutesPerDay, perShiftCents: permission.perShiftCents, validFrom: permission.validFrom, expiresOn: permission.expiresOn }),
      canPause: pauses && permission.status === "active",
      canResume: grants && permission.status === "paused",
      canEnd: grants && permission.status !== "revoked",
    }))
    .toReversed();
}
