import { calculateCaregiverBill } from "@kin/domain";
import { sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";

export type CaregiverBillingReason =
  | "refused" | "invalid" | "missing_rate" | "rate_changed" | "duplicate" | "key_reused"
  | "not_waiting" | "above_ceiling" | "paused" | "no_agreement" | "receiver" | "payment_in_progress";

export class CaregiverBillingError extends Error {
  readonly retryable = false;
  readonly reason: CaregiverBillingReason;
  readonly billId: string | null;
  constructor(reason: CaregiverBillingReason, billId: string | null = null) {
    super(`Caregiver billing refused: ${reason}`);
    this.reason = reason;
    this.billId = billId;
    this.name = "CaregiverBillingError";
  }
}

type Configuration = { readonly circleId: string; readonly memberId: string; readonly payeeId?: string | null; readonly name: string; readonly rateCentsPerHour: number };

/** Run as the person: the narrow database operation rechecks their organizer membership. */
export async function configureCaregiver(tx: Transaction, input: Configuration): Promise<string> {
  if (!Number.isSafeInteger(input.rateCentsPerHour) || input.rateCentsPerHour <= 0 || input.name.trim().length === 0 || input.name.trim().length > 80) throw new CaregiverBillingError("invalid");
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.configure_caregiver(${input.circleId}::uuid, ${input.memberId}::uuid, ${input.payeeId ?? null}::uuid, ${input.name.trim()}, ${input.rateCentsPerHour}::bigint) as id`);
    return requiredId(result.rows[0]?.id);
  });
}

/**
 * Records where the caregiver's own pay goes. Only the caregiver may, for
 * their own payee; the database checks the address and refuses to change it
 * while a payment to them is waiting for approval or under way.
 */
export async function setOwnReceiver(tx: Transaction, input: { readonly circleId: string; readonly email: string }): Promise<void> {
  try {
    await operation(() => tx.execute(sql`select kin_private.set_own_receiver(${input.circleId}::uuid, ${input.email})`));
  } catch (error) {
    // The database's only check_violation here is the address itself.
    if (error instanceof CaregiverBillingError && error.reason === "invalid") throw new CaregiverBillingError("receiver");
    throw error;
  }
}

/** The snapshot is parsed once in the domain; the database checks the current rate and identity. */
export async function submitCaregiverBill(tx: Transaction, input: { readonly circleId: string; readonly details: unknown; readonly submissionKey: string }): Promise<string> {
  const bill = calculateCaregiverBill(input.details);
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.submit_caregiver_bill(${input.circleId}::uuid, ${input.submissionKey}::uuid, ${JSON.stringify(bill.details)}::jsonb, ${bill.cents}::bigint) as id`);
    return requiredId(result.rows[0]?.id);
  });
}

const REASONS: Readonly<Record<string, CaregiverBillingReason>> = {
  "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid",
  KB001: "missing_rate", KB002: "rate_changed", KB003: "duplicate", KB004: "key_reused",
  KB005: "not_waiting", KB006: "above_ceiling", KB007: "paused", KB008: "no_agreement", KB009: "payment_in_progress",
};

/** Runs one narrow caregiver operation, turning the database's refusals into typed reasons. */
export async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const postgres = postgresError(error);
    const reason = REASONS[postgres?.code ?? ""];
    if (reason) throw new CaregiverBillingError(reason, reason === "duplicate" && typeof postgres?.detail === "string" && /^[0-9a-f-]{36}$/.test(postgres.detail) ? postgres.detail : null);
    throw error;
  }
}

export function postgresError(error: unknown): { code: string; detail: unknown } | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return { code: error.code, detail: "detail" in error ? error.detail : null };
  return "cause" in error ? postgresError(error.cause) : null;
}

export function requiredId(id: string | undefined): string {
  if (!id) throw new Error("The caregiver operation returned no bill or payee");
  return id;
}
