export type LedgerErrorReason =
  | "unknown_account"
  | "invalid_entry"
  | "unbalanced"
  | "mixed_memo"
  | "wrong_circle"
  | "wrong_currency"
  | "duplicate_id"
  | "source_conflict"
  | "invalid_reversal";

/** The ledger refused an entry. The entry is wrong, so retrying cannot help. */
export class LedgerError extends Error {
  readonly retryable = false;
  readonly reason: LedgerErrorReason;

  constructor(reason: LedgerErrorReason, message: string) {
    super(message);
    this.name = "LedgerError";
    this.reason = reason;
  }
}
