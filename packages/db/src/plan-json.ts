import { CIRCLE_ROLES, type ApprovalPlan, type ApprovalSlot, type CircleRole } from "@kin/domain";

/** A stored plan that is not one the approval engine could have made. */
export class StoredPlanError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(`A stored approval plan is malformed: ${message}`);
    this.name = "StoredPlanError";
  }
}

const SLOT_REASONS: readonly ApprovalSlot["reason"][] = ["parent_decides", "organizer", "second_approval"];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: Json, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new StoredPlanError(`${key} is not text`);
  return field;
}

function date(value: Json, key: string): Date {
  const parsed = new Date(text(value, key));
  if (Number.isNaN(parsed.getTime())) throw new StoredPlanError(`${key} is not a date`);
  return parsed;
}

function slot(value: unknown): ApprovalSlot {
  if (!isObject(value)) throw new StoredPlanError("a slot is not an object");
  const reason = SLOT_REASONS.find((each) => each === value.reason);
  if (!reason) throw new StoredPlanError("a slot has an unknown reason");
  const roles = value.roles;
  if (!Array.isArray(roles) || roles.length === 0) throw new StoredPlanError("a slot names no roles");
  const known = roles.map((role) => {
    const match = CIRCLE_ROLES.find((each) => each === role);
    if (!match) throw new StoredPlanError("a slot names an unknown role");
    return match;
  });
  return { reason, roles: known satisfies CircleRole[] };
}

/**
 * Reads back the approval plan stored with a proposal: what the approval
 * engine decided when it was raised, which is what governs it from then on.
 * Storage is checked, not trusted.
 */
export function parseApprovalPlan(value: unknown): ApprovalPlan {
  if (!isObject(value)) throw new StoredPlanError("not an object");
  switch (value.outcome) {
    case "paused":
      return { outcome: "paused", until: date(value, "until") };
    case "refused":
      if (value.reason !== "above_ceiling") throw new StoredPlanError("unknown refusal");
      return { outcome: "refused", reason: "above_ceiling" };
    case "standing_rule": {
      const version = value.agreementVersion;
      if (typeof version !== "number" || !Number.isInteger(version)) throw new StoredPlanError("agreementVersion is not a whole number");
      return { outcome: "standing_rule", ruleId: text(value, "ruleId"), agreementVersion: version };
    }
    case "needs_approval": {
      if (!Array.isArray(value.slots) || value.slots.length === 0) throw new StoredPlanError("no slots");
      const payee = value.payeeMemberId;
      if (payee !== null && typeof payee !== "string") throw new StoredPlanError("payeeMemberId is neither text nor null");
      if (typeof value.announceToCircle !== "boolean") throw new StoredPlanError("announceToCircle is not true or false");
      return {
        outcome: "needs_approval",
        slots: value.slots.map(slot),
        payeeMemberId: payee,
        announceToCircle: value.announceToCircle,
        expiresAt: date(value, "expiresAt"),
      };
    }
    default:
      throw new StoredPlanError("unknown outcome");
  }
}
