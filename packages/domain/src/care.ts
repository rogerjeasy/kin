const MINUTES_PER_HOUR = 60n;

/** The care entry cannot be valued. Retrying cannot help. */
export class CareValueError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "CareValueError";
  }
}

/**
 * What a stretch of hands-on care is worth at the family's rate. Each care
 * entry is valued once, when it is approved, and rounded to the nearest cent
 * with halves rounded up.
 */
export function careValueCents(
  minutes: number,
  rateCentsPerHour: number,
): number {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new CareValueError(
      `Care time must be a whole number of minutes above zero, got ${minutes}`,
    );
  }
  if (!Number.isSafeInteger(rateCentsPerHour) || rateCentsPerHour < 0) {
    throw new CareValueError(
      `The care rate must be a whole number of cents, got ${rateCentsPerHour}`,
    );
  }
  const value =
    (BigInt(minutes) * BigInt(rateCentsPerHour) + MINUTES_PER_HOUR / 2n) /
    MINUTES_PER_HOUR;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CareValueError("The care value is too large to hold exactly");
  }
  return Number(value);
}
