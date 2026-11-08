import { confirmedPayments, type RecordFacts } from "@kin/domain";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { readLedger } from "./ledger-store.ts";
import { LetterError } from "./letters.ts";
import { bills, circles, claimChecks, officeCalls, payees } from "./schema/index.ts";
import type { ClaimVerdict } from "./values.ts";

const REASONS: Readonly<Record<string, "refused" | "invalid">> = { "42501": "refused", "23514": "invalid", "22P02": "invalid" };

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}

export type TranscriptTurn = { readonly from: "kin" | "caller"; readonly text: string };

export type OfficeCallInput = {
  readonly circleId: string;
  readonly callerNumber: string | null;
  readonly callerName: string | null;
  readonly organization: string | null;
  readonly claimedCents: number | null;
  readonly purpose: string | null;
  readonly reference: string | null;
  readonly transcript: readonly TranscriptTurn[];
  readonly pressureSignals: readonly string[];
  readonly simulated: boolean;
  readonly payeeId: string | null;
  readonly foundEntryId: string | null;
  readonly verdict: ClaimVerdict;
  /** A key the app words in each language, such as `falseDemand`. */
  readonly topic: string;
  /** The family's alert, after the number guard. */
  readonly spoken: string;
  /** What the caller claimed, as one line for the claim check. */
  readonly claim: string;
};

/**
 * Records a call to the office line, the claim check it produced, and the
 * alert to every member who sees the circle's money. Run as the person inside
 * `asPerson`: the database operation rechecks their role.
 */
export async function recordOfficeCall(tx: Transaction, input: OfficeCallInput): Promise<{ callId: string; claimCheckId: string }> {
  try {
    const signals = `{${input.pressureSignals.join(",")}}`;
    const result = await tx.execute<{ recorded: { callId: string; claimCheckId: string } }>(
      sql`select kin_private.record_office_call(${input.circleId}::uuid, ${input.callerNumber}, ${input.callerName}, ${input.organization}, ${input.claimedCents}::bigint, ${input.purpose}, ${input.reference}, ${JSON.stringify(input.transcript)}::jsonb, ${signals}::text[], ${input.simulated}, ${input.payeeId}::uuid, ${input.foundEntryId}::uuid, ${input.verdict}::public.claim_verdict, ${input.topic}, ${input.spoken}, ${input.claim}) as recorded`,
    );
    const recorded = result.rows[0]?.recorded;
    if (!recorded) throw new Error("The office call operation returned nothing");
    return recorded;
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new LetterError(reason);
    throw error;
  }
}

export type OfficeCallRecord = {
  readonly id: string;
  readonly calledOn: string;
  readonly organization: string | null;
  readonly claimedCents: number | null;
  readonly verdict: ClaimVerdict;
  /** The payee the caller named, when the circle knows them: with a `no_match` verdict it means the account was already paid. */
  readonly payeeId: string | null;
  readonly pressureSignals: readonly string[];
  readonly simulated: boolean;
  readonly transcript: readonly TranscriptTurn[];
};

function turns(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((turn: unknown) => {
    if (turn === null || typeof turn !== "object") return [];
    const { from, text } = turn as { from?: unknown; text?: unknown };
    return (from === "kin" || from === "caller") && typeof text === "string" ? [{ from, text }] : [];
  });
}

/** The circle's most recent calls to the office line, newest first. Row-level security limits who sees any. */
export async function readOfficeCalls(tx: Transaction, circleId: string, limit = 20): Promise<OfficeCallRecord[]> {
  const rows = await tx
    .select({ call: officeCalls, payeeId: claimChecks.payeeId })
    .from(officeCalls)
    .innerJoin(claimChecks, and(eq(claimChecks.circleId, officeCalls.circleId), eq(claimChecks.id, officeCalls.claimCheckId)))
    .where(eq(officeCalls.circleId, circleId))
    .orderBy(desc(officeCalls.createdAt))
    .limit(limit);
  return rows.map(({ call: row, payeeId }) => ({
    id: row.id,
    payeeId,
    calledOn: row.calledOn,
    organization: row.organization,
    claimedCents: row.claimedCents,
    verdict: row.verdict,
    pressureSignals: row.pressureSignals,
    simulated: row.simulated,
    transcript: turns(row.transcript),
  }));
}

/** A call that came in over the telephone: the same facts as a simulated one, but never labelled simulated. */
export type LineCallInput = Omit<OfficeCallInput, "simulated"> & {
  /** Twilio's id for the call: recording the same one again returns the call already recorded. */
  readonly callSid: string;
};

/**
 * Records a call that came in over the telephone, the claim check it produced
 * and the alert to the family, as Kin's service identity. Run inside
 * `asService` for the circle the dialled number belongs to: the database
 * operation refuses any other circle. It records a call once: a second delivery
 * for the same call id, even at the same moment, gets the first one's ids and
 * changes nothing, so "already recorded" is a success here.
 */
export async function recordLineCall(tx: Transaction, input: LineCallInput): Promise<{ callId: string; claimCheckId: string }> {
  try {
    const signals = `{${input.pressureSignals.join(",")}}`;
    const result = await tx.execute<{ recorded: { callId: string; claimCheckId: string } }>(
      sql`select kin_private.record_office_line_call(${input.circleId}::uuid, ${input.callSid}, ${input.callerNumber}, ${input.callerName}, ${input.organization}, ${input.claimedCents}::bigint, ${input.purpose}, ${input.reference}, ${JSON.stringify(input.transcript)}::jsonb, ${signals}::text[], ${input.payeeId}::uuid, ${input.foundEntryId}::uuid, ${input.verdict}::public.claim_verdict, ${input.topic}, ${input.spoken}, ${input.claim}) as recorded`,
    );
    const recorded = result.rows[0]?.recorded;
    if (!recorded) throw new Error("The office line operation returned nothing");
    return recorded;
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new LetterError(reason);
    throw error;
  }
}

/** What the phone line checks a caller's demand against, and the currency of the circle it speaks for. */
export type LineRecord = { readonly currency: string; readonly record: RecordFacts };

/**
 * The record of one circle as the phone line may read it: payees, bills and
 * confirmed payments. Run inside `asService`; `null` when the circle is not
 * active, so a closed circle's number answers like an unknown one.
 */
export async function readLineRecord(tx: Transaction, circleId: string): Promise<LineRecord | null> {
  const [circle] = await tx.select({ id: circles.id, currency: circles.currency }).from(circles).where(and(eq(circles.id, circleId), eq(circles.status, "active")));
  if (!circle) return null;
  const [payeeRows, billRows, ledger] = await Promise.all([
    // A member's settlement address is a payee row of its own category, and never one a caller could be asking as.
    tx.select({ id: payees.id, name: payees.name }).from(payees).where(and(eq(payees.circleId, circleId), ne(payees.category, "settlement"))),
    tx.select({ payeeId: bills.payeeId, cents: bills.amountCents, state: bills.state }).from(bills).where(eq(bills.circleId, circleId)),
    readLedger(tx, circle),
  ]);
  return { currency: circle.currency, record: { payees: payeeRows, bills: billRows, payments: confirmedPayments(ledger.entries) } };
}
