import type { CircleSnapshot, MandateRecord } from "@kin/db";

import { may } from "@/server/dashboard-context";

export type MandateView = {
  readonly mandate: MandateRecord;
  /** The refill rule it covers, by the item's own name. */
  readonly item: string;
  readonly payeeId: string;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canEnd: boolean;
};

/**
 * Whether the viewer may record, resume or end a standing permission: the
 * parent in their own name, or in a demo circle the organizer playing the
 * parent's spoken yes. The database refuses anyone else again.
 */
export function mayGrantMandate(circle: CircleSnapshot): boolean {
  return may(circle, "mandate.grant") && (circle.viewer.role === "parent" || circle.circle.demo);
}

/** The circle's mandates, newest first, with what the viewer may do to each. */
export function mandateViews(circle: CircleSnapshot): MandateView[] {
  const grants = mayGrantMandate(circle);
  const pauses = may(circle, "mandate.pause");
  return circle.mandates
    .map((mandate) => {
      const rule = circle.purchaseRules.find((each) => each.id === mandate.ruleId);
      return {
        mandate,
        item: rule?.item ?? "",
        payeeId: rule?.payeeId ?? "",
        canPause: pauses && mandate.status === "active",
        canResume: grants && mandate.status === "paused",
        canEnd: grants && mandate.status !== "revoked",
      };
    })
    .toReversed();
}
