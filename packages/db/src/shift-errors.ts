import type { ShiftPermissionTermsRefusal } from "@kin/domain";

import { postgresError } from "./caregiver-billing.ts";

/**
 * Why a shift operation was refused, as a reason a screen can word. A reason
 * is never a database message: the database's own refusals are mapped here.
 */
export type ShiftReason =
  | ShiftPermissionTermsRefusal
  | "refused"
  | "invalid"
  | "key_reused"
  | "bad_member"
  | "wrong_state"
  | "visit_too_short"
  | "visit_too_long"
  | "own_shift"
  | "parent_can_answer"
  | "not_started"
  | "not_paid_kind"
  | "keys_missing"
  | "missing_rate"
  | "above_ceiling"
  | "paused"
  | "no_agreement"
  | "payment_in_progress"
  | "parent_only"
  | "no_parent"
  | "not_covered"
  | "care_agreement"
  | "invalid_target";

/** A shift operation was refused. Asking again cannot help until what blocks it changes. */
export class ShiftError extends Error {
  readonly retryable = false;
  readonly reason: ShiftReason;

  constructor(reason: ShiftReason) {
    super(`A shift operation was refused: ${reason}`);
    this.name = "ShiftError";
    this.reason = reason;
  }
}

// SQLSTATE codes are listed in migration 0033_shift-access.sql.
const REASONS: Readonly<Record<string, ShiftReason>> = {
  "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid", "22003": "invalid", "23001": "invalid",
  KS001: "bad_member", KS002: "wrong_state", KS003: "visit_too_short", KS004: "visit_too_long", KS005: "own_shift", KS006: "parent_can_answer",
  KS007: "not_started", KS008: "not_paid_kind", KS009: "keys_missing",
  KB001: "missing_rate", KB004: "key_reused", KB006: "above_ceiling", KB007: "paused", KB008: "no_agreement", KB009: "payment_in_progress",
  KM001: "parent_only", KM002: "no_parent", KM010: "not_covered",
};

/** Runs one shift operation, turning the database's refusals into typed reasons. */
export async function shiftOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new ShiftError(reason);
    throw error;
  }
}
