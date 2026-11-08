import { postgresError } from "./caregiver-billing.ts";
import { shiftOperation } from "./shift-errors.ts";

/**
 * Why a check-in link or a call operation was refused for a reason only these
 * have, as a reason a screen can word. Every other refusal on these paths is a
 * `ShiftError`, with the reasons of the care shifts (`refused`, `not_started`,
 * `visit_too_short`, `wrong_state`...).
 */
export type ShiftCallReason =
  /** The shift already has the five live check-in links it may. */
  | "too_many_links"
  /** A call is switched on only with the parent's consent. */
  | "consent_needed"
  /** There is no such call for this shift. */
  | "no_such_call"
  /** The call is not in a state that allows this: it is over, or has not been placed. */
  | "call_over";

/** A link or call operation was refused. Asking again cannot help until what blocks it changes. */
export class ShiftCallError extends Error {
  readonly retryable = false;
  readonly reason: ShiftCallReason;

  constructor(reason: ShiftCallReason) {
    super(`A link or call operation was refused: ${reason}`);
    this.name = "ShiftCallError";
    this.reason = reason;
  }
}

// SQLSTATE codes are listed in migration 0037_shift-links-and-calls-access.sql.
const REASONS: Readonly<Record<string, ShiftCallReason>> = { KS010: "too_many_links", KC001: "consent_needed", KC002: "no_such_call", KC003: "call_over" };

/** Runs one link or call operation, turning the database's refusals into typed reasons: a `ShiftCallError` for these, a `ShiftError` for the shifts'. */
export async function callOperation<T>(work: () => Promise<T>): Promise<T> {
  return shiftOperation(async () => {
    try {
      return await work();
    } catch (error) {
      const reason = REASONS[postgresError(error)?.code ?? ""];
      if (reason) throw new ShiftCallError(reason);
      throw error;
    }
  });
}
