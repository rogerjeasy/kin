/**
 * Why a call to PayPal failed, so a caller can tell a refusal from an outage.
 *
 * - `rejected`: PayPal answered and said no (a 4xx such as a declined card or
 *   an order that cannot be captured). Repeating the call cannot help.
 * - `unavailable`: no answer, or a server error, after the retries. For a
 *   write, Kin cannot know whether it took effect: uncertain means stop, so
 *   the caller reads the resource back instead of assuming either way.
 */
export class PayPalError extends Error {
  readonly outcome: "rejected" | "unavailable";
  readonly retryable: boolean;
  readonly status: number | null;
  /** PayPal's error name, such as `UNPROCESSABLE_ENTITY`, when it sent one. */
  readonly issue: string | null;
  /** PayPal's debug ID, which a support request to PayPal needs. */
  readonly debugId: string | null;

  constructor(details: { outcome: "rejected" | "unavailable"; status: number | null; issue: string | null; debugId: string | null; operation: string }) {
    super(`PayPal ${details.operation} ${details.outcome}${details.status === null ? "" : ` (HTTP ${details.status})`}${details.issue === null ? "" : `: ${details.issue}`}`);
    this.name = "PayPalError";
    this.outcome = details.outcome;
    this.retryable = details.outcome === "unavailable";
    this.status = details.status;
    this.issue = details.issue;
    this.debugId = details.debugId;
  }
}
