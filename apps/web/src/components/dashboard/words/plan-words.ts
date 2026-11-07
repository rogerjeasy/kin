import type { ApprovalPlan } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";

type PlanLabel = keyof Dictionary["dashboard"]["common"]["planLabels"];

/** What the approval engine will ask of a payment, in a few words. */
export function planLabel(plan: ApprovalPlan): PlanLabel {
  switch (plan.outcome) {
    case "standing_rule":
      return "standing";
    case "mandate":
      return "mandate";
    case "refused":
      return "refused";
    case "paused":
      return "paused";
    case "needs_approval": {
      const parent = plan.slots.some((slot) => slot.reason === "parent_decides");
      const second = plan.slots.some((slot) => slot.reason === "second_approval");
      if (parent) return second ? "parentAndSecond" : "parent";
      return second ? "organizerAndSecond" : "organizer";
    }
  }
}
