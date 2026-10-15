/** The database did not answer in time. Retrying later may help. */
export class DatabaseUnavailableError extends Error {
  readonly retryable = true;

  constructor(deadlineMs: number, cause: unknown) {
    super(`The database did not answer within ${Math.round(deadlineMs / 1000)} seconds`, { cause });
    this.name = "DatabaseUnavailableError";
  }
}

type WaitOptions = {
  readonly deadlineMs: number;
  readonly intervalMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

/**
 * Tries `probe` until it succeeds or the deadline passes. Aurora Serverless
 * at zero capacity pauses when idle and takes a minute or more to resume on
 * the first connection (74 seconds on 15 October 2026), longer than one
 * connection attempt waits.
 */
export async function waitForDatabase(probe: () => Promise<void>, options: WaitOptions): Promise<{ attempts: number; waitedMs: number }> {
  const start = options.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await probe();
      return { attempts, waitedMs: options.now() - start };
    } catch (error) {
      if (options.now() - start + options.intervalMs > options.deadlineMs) {
        throw new DatabaseUnavailableError(options.deadlineMs, error);
      }
      await options.sleep(options.intervalMs);
    }
  }
}
