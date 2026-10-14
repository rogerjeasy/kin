/** The approval engine was given facts it cannot judge. Retrying cannot help. */
export class ApprovalError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}
