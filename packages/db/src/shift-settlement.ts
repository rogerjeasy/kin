import {
  CareAgreementGateError,
  ShiftPriceError,
  decideShiftPermission,
  isPaused,
  planShiftPayout,
  priceShift,
  shiftDay,
  type ParentLevel,
  type ShiftPermission,
  type ShiftPermissionRefusal,
  type ShiftRules,
} from "@kin/domain";
import { and, eq, sql } from "drizzle-orm";

import { assertCaregiverWorkCovered } from "./care-agreements.ts";
import { requiredId } from "./caregiver-billing.ts";
import type { Transaction } from "./connection.ts";
import { ShiftError, shiftOperation } from "./shift-errors.ts";
import { proposals, shifts } from "./schema/index.ts";

/** How a confirmed shift was settled: paid on the parent's standing permission, or put to the family. */
export type ShiftSettled = {
  readonly proposalId: string;
  readonly outcome: "paid_by_permission" | "asks_family";
  readonly permissionId: string | null;
  /** Why the nearest permission did not cover it, when the family is asked. `null` when none was live, and on a retry. */
  readonly askReason: ShiftPermissionRefusal | null;
  readonly cents: number;
};

type Json = Record<string, unknown>;

/** What the database reports about a shift's payment: see `kin_private.shift_payment_facts` in migration 0033. */
type Facts = {
  readonly timezone: string;
  readonly now: Date;
  readonly pausedUntil: Date | null;
  readonly today: string;
  readonly parentDecides: boolean;
  readonly payee: { readonly id: string; readonly memberId: string; readonly status: "approved" | "new"; readonly rules: ShiftRules };
  readonly agreement: { readonly version: number; readonly ceilingCents: number; readonly secondApprovalAboveCents: number; readonly parentDecidesAboveCents: number } | null;
  readonly permissions: readonly { readonly permission: ShiftPermission; readonly minutesUsedThatDay: number }[];
};

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function field(value: Json, key: string): unknown {
  const found = value[key];
  if (found === undefined) throw new Error(`The shift's payment facts have no ${key}`);
  return found;
}
const text = (value: Json, key: string): string => {
  const found = field(value, key);
  if (typeof found !== "string") throw new Error(`The shift's payment fact ${key} is not text`);
  return found;
};
const whole = (value: Json, key: string): number => {
  const found = field(value, key);
  if (typeof found !== "number" || !Number.isSafeInteger(found)) throw new Error(`The shift's payment fact ${key} is not a whole number`);
  return found;
};
const objectAt = (value: Json, key: string): Json => {
  const found = field(value, key);
  if (!isObject(found)) throw new Error(`The shift's payment fact ${key} is not an object`);
  return found;
};

function parseFacts(raw: unknown): Facts {
  if (!isObject(raw)) throw new Error("The shift's payment facts are not an object");
  const payee = objectAt(raw, "payee");
  const status = text(payee, "status");
  if (status !== "approved" && status !== "new") throw new Error("The shift's payee has an unknown status");
  const after = field(payee, "overtimeAfterMinutes");
  const agreement = field(raw, "agreement");
  const paused = field(raw, "pausedUntil");
  const permissions = field(raw, "permissions");
  if (!Array.isArray(permissions)) throw new Error("The shift's permissions are not a list");
  return {
    timezone: text(raw, "timezone"),
    now: new Date(text(raw, "now")),
    pausedUntil: paused === null ? null : new Date(text(raw, "pausedUntil")),
    today: text(raw, "today"),
    parentDecides: field(raw, "parentDecides") === true,
    payee: {
      id: text(payee, "id"),
      memberId: text(payee, "memberId"),
      status,
      rules: {
        rateCentsPerHour: whole(payee, "rateCentsPerHour"),
        minimumMinutes: whole(payee, "minimumMinutes"),
        overtimeAfterMinutes: after === null ? null : whole(payee, "overtimeAfterMinutes"),
        overtimePercent: whole(payee, "overtimePercent"),
      },
    },
    agreement: agreement === null ? null : parseAgreement(agreement),
    permissions: permissions.map(parsePermission),
  };
}

function parseAgreement(value: unknown): NonNullable<Facts["agreement"]> {
  if (!isObject(value)) throw new Error("The shift's agreement is not an object");
  return {
    version: whole(value, "version"),
    ceilingCents: whole(value, "ceilingCents"),
    secondApprovalAboveCents: whole(value, "secondApprovalAboveCents"),
    parentDecidesAboveCents: whole(value, "parentDecidesAboveCents"),
  };
}

function parsePermission(value: unknown): Facts["permissions"][number] {
  if (!isObject(value)) throw new Error("A shift permission is not an object");
  const status = text(value, "status");
  if (status !== "active" && status !== "paused" && status !== "revoked") throw new Error("A shift permission has an unknown status");
  return {
    permission: {
      permissionId: text(value, "id"),
      payeeId: text(value, "payeeId"),
      status,
      maxMinutesPerDay: whole(value, "maxMinutesPerDay"),
      perShiftCents: whole(value, "perShiftCents"),
      validFrom: text(value, "validFrom"),
      expiresOn: text(value, "expiresOn"),
    },
    minutesUsedThatDay: whole(value, "minutesUsedThatDay"),
  };
}

/** The reason a priced-by-code refusal becomes: the database would say the same, but earlier is kinder. */
function priceFailure(error: ShiftPriceError): ShiftError {
  return new ShiftError(error.reason === "no_visit" ? "visit_too_short" : error.reason === "too_long" ? "visit_too_long" : "invalid");
}

/**
 * Settles a shift whose two keys have turned. Plain code prices it from the
 * minutes and the caregiver's agreed rules, and checks it against the
 * parent's standing permissions: a shift inside one is approved at once, with
 * the permission recorded as the approver, and the existing payout path pays
 * it; a shift outside every permission becomes an ordinary caregiver payout
 * the family answers. The database prices the shift again and refuses any plan
 * that does not match, so what is paid is never what a caller said.
 *
 * Run as the person, inside `asPerson`: the shift's own caregiver may run it
 * (their check-out can be the last key), the organizers, contributors and the
 * parent too. The circle's clock is the database's own; `now` is accepted so a
 * caller can pass the circle's moment but is not what the plan is made on.
 * A retry returns the proposal already raised.
 */
export async function settleShift(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly now?: Date }): Promise<ShiftSettled> {
  return settleConfirmedShift(tx, input);
}

/**
 * Settles a shift as Kin's worker, with no person: the same decision as
 * `settleShift`, by the same code, so a shift settled here ends up identical to
 * one a person settled. Run as Kin's service, inside `asService`, for the
 * circle in scope, after leasing a `SHIFT_SETTLE_TOPIC` message. The database
 * records the settling as the service's own (audit actor "service", origin
 * "worker"), and refuses it for any other circle. A refusal that is a hold
 * (`SHIFT_HOLD_REASONS`: a paused circle, no agreement...) leaves the shift
 * confirmed, to be settled again later.
 */
export async function settleShiftAsService(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string }): Promise<ShiftSettled> {
  return settleConfirmedShift(tx, input);
}

async function settleConfirmedShift(tx: Transaction, input: { readonly circleId: string; readonly shiftId: string; readonly now?: Date }): Promise<ShiftSettled> {
  const { circleId, shiftId } = input;
  const [shift] = await tx.select().from(shifts).where(and(eq(shifts.circleId, circleId), eq(shifts.id, shiftId)));
  if (!shift) throw new ShiftError("refused");
  if (shift.proposalId !== null) return recorded(tx, circleId, shift.proposalId, null);
  if (shift.kind !== "aide" || shift.payeeId === null) throw new ShiftError("not_paid_kind");
  if (shift.state === "cancelled") throw new ShiftError("wrong_state");
  if (shift.state !== "confirmed" || shift.checkedInAt === null || shift.checkedOutAt === null) throw new ShiftError("keys_missing");

  const facts = await readFacts(tx, circleId, shiftId);
  if (facts.agreement === null) throw new ShiftError("no_agreement");
  const price = (() => {
    try {
      return priceShift(shift.checkedInAt, shift.checkedOutAt, facts.payee.rules);
    } catch (error) {
      if (error instanceof ShiftPriceError) throw priceFailure(error);
      throw error;
    }
  })();
  if (isPaused(facts.pausedUntil, facts.now)) throw new ShiftError("paused");
  // Once the caregiver has a care agreement on file, only work it covers at this rate is paid; the shift waits, confirmed, for a signature.
  try {
    await assertCaregiverWorkCovered(tx, { circleId, payeeId: shift.payeeId, workDates: [shiftDay(shift.checkedInAt, facts.timezone)], rateCentsPerHour: facts.payee.rules.rateCentsPerHour });
  } catch (error) {
    if (error instanceof CareAgreementGateError) throw new ShiftError("care_agreement");
    throw error;
  }
  if (price.cents > facts.agreement.ceilingCents) throw new ShiftError("above_ceiling");

  const decision = decideShiftPermission(
    facts.permissions.map((candidate) => ({
      permission: candidate.permission,
      today: facts.today,
      circlePaused: isPaused(facts.pausedUntil, facts.now),
      minutesUsedThatDay: candidate.minutesUsedThatDay,
    })),
    { payeeId: shift.payeeId, day: shiftDay(shift.checkedInAt, facts.timezone), billableMinutes: price.billableMinutes, cents: price.cents },
  );
  const covered = decision?.outcome === "covered" ? decision.permissionId : null;
  const plan = covered !== null ? { outcome: "shift_permission", permissionId: covered, agreementVersion: facts.agreement.version } : askPlan(facts, price.cents);
  const result = await shiftOperation(() =>
    tx.execute<{ id: string }>(sql`select kin_private.pay_shift(${circleId}::uuid, ${shiftId}::uuid, ${JSON.stringify(plan)}::jsonb) as id`),
  );
  return recorded(tx, circleId, requiredId(result.rows[0]?.id), decision?.outcome === "ask_family" ? decision.reason : null);
}

function askPlan(facts: Facts, cents: number) {
  if (facts.agreement === null) throw new ShiftError("no_agreement");
  const parentLevel: ParentLevel = facts.parentDecides ? "decides" : "informed";
  const plan = planShiftPayout({
    cents,
    // The caregiver is the member being paid, so they can never be the only yes.
    payee: { status: facts.payee.status, member: { memberId: facts.payee.memberId, role: "caregiver" }, autoPay: null },
    agreement: {
      version: facts.agreement.version,
      approvals: {
        ceilingCents: facts.agreement.ceilingCents,
        secondApprovalAboveCents: facts.agreement.secondApprovalAboveCents,
        parentDecidesAboveCents: facts.agreement.parentDecidesAboveCents,
      },
    },
    parentLevel,
    pausedUntil: facts.pausedUntil,
    now: facts.now,
  });
  if (plan.outcome === "paused") throw new ShiftError("paused");
  if (plan.outcome === "refused") throw new ShiftError("above_ceiling");
  return plan;
}

async function readFacts(tx: Transaction, circleId: string, shiftId: string): Promise<Facts> {
  const result = await shiftOperation(() =>
    tx.execute<{ facts: unknown }>(sql`select kin_private.shift_payment_facts(${circleId}::uuid, ${shiftId}::uuid) as facts`),
  );
  return parseFacts(result.rows[0]?.facts);
}

// What the shift and its proposal now say, not what was asked: a retry returns the payment already raised.
async function recorded(tx: Transaction, circleId: string, proposalId: string, askReason: ShiftPermissionRefusal | null): Promise<ShiftSettled> {
  const [row] = await tx
    .select({ cents: proposals.cents, plan: proposals.plan })
    .from(proposals)
    .where(and(eq(proposals.circleId, circleId), eq(proposals.id, proposalId)));
  if (!row) throw new ShiftError("refused");
  const plan = row.plan as { outcome?: string; permissionId?: unknown };
  if (plan.outcome === "shift_permission" && typeof plan.permissionId === "string") {
    return { proposalId, outcome: "paid_by_permission", permissionId: plan.permissionId, askReason: null, cents: row.cents };
  }
  return { proposalId, outcome: "asks_family", permissionId: null, askReason, cents: row.cents };
}
