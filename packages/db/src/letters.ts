import { sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import type { BillState } from "@kin/domain";
import type { ClaimVerdict, DocumentKind } from "./values.ts";

export type LetterReason = "refused" | "invalid";

/** The database refused to record a letter or a claim check. Retrying cannot help. */
export class LetterError extends Error {
  readonly retryable = false;
  readonly reason: LetterReason;
  constructor(reason: LetterReason) {
    super(`Letters refused: ${reason}`);
    this.reason = reason;
    this.name = "LetterError";
  }
}

const REASONS: Readonly<Record<string, LetterReason>> = { "42501": "refused", "23514": "invalid", "22P02": "invalid", "22007": "invalid", "22008": "invalid" };

async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new LetterError(reason);
    throw error;
  }
}

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}

export type LetterInput = {
  readonly circleId: string;
  readonly kind: DocumentKind;
  /** An existing payee the letter is from, or `null` to record a new one under `sender`. */
  readonly payeeId: string | null;
  readonly sender: string | null;
  readonly amountCents: number | null;
  readonly dueOn: string | null;
  /** The checked reading, kept with the document. */
  readonly extraction: Readonly<Record<string, unknown>>;
  readonly confidence: number;
};

export type LetterRecorded = {
  readonly documentId: string;
  readonly billId: string | null;
  readonly billState: BillState | null;
  readonly payeeId: string | null;
  readonly duplicateOf: string | null;
};

/**
 * Records what Kin read from a letter and, for a bill from a named sender,
 * the bill waiting for review. Run as the person, inside `asPerson`: the
 * database operation rechecks their role and the circle, and no direct
 * write to a document, bill or payee is granted to the web app.
 */
export async function addLetter(tx: Transaction, input: LetterInput): Promise<LetterRecorded> {
  return operation(async () => {
    const result = await tx.execute<{ recorded: LetterRecorded }>(
      sql`select kin_private.add_letter(${input.circleId}::uuid, ${input.kind}::public.document_kind, ${input.payeeId}::uuid, ${input.sender}, ${input.amountCents}::bigint, ${input.dueOn}::date, ${JSON.stringify(input.extraction)}::jsonb, ${input.confidence}::real) as recorded`,
    );
    const recorded = result.rows[0]?.recorded;
    if (!recorded) throw new Error("The letter operation returned nothing");
    return recorded;
  });
}

export type ClaimCheckInput = {
  readonly circleId: string;
  readonly payeeId: string | null;
  readonly claimedCents: number | null;
  readonly claim: string;
  readonly foundEntryId: string | null;
  readonly verdict: ClaimVerdict;
  /** A key the app words in each language, such as `falseDemand`. */
  readonly topic: string;
  /** The words Kin spoke, after the number guard. */
  readonly spoken: string;
};

/**
 * Records a demand Kin checked, the verdict plain code reached, and tells
 * every member who sees the circle's money. Returns the check's ID.
 */
export async function recordClaimCheck(tx: Transaction, input: ClaimCheckInput): Promise<string> {
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.record_claim_check(${input.circleId}::uuid, ${input.payeeId}::uuid, ${input.claimedCents}::bigint, ${input.claim}, ${input.foundEntryId}::uuid, ${input.verdict}::public.claim_verdict, ${input.topic}, ${input.spoken}) as id`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("The claim check operation returned no ID");
    return id;
  });
}
