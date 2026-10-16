/**
 * Small readers for PayPal's JSON. Every response is parsed at the boundary,
 * so the rest of Kin works with typed values and never with `unknown`.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

/** PayPal sent something other than the shape Kin relies on. */
export class PayPalShapeError extends Error {
  readonly retryable = false;

  constructor(what: string) {
    super(`PayPal's response has no valid ${what}`);
    this.name = "PayPalShapeError";
  }
}

export function asRecord(value: unknown, what: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PayPalShapeError(what);
  return value as JsonRecord;
}

export function optionalRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function requiredText(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") throw new PayPalShapeError(key);
  return value;
}

export function optionalText(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function recordList(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.flatMap((each) => (optionalRecord(each) ? [each as JsonRecord] : [])) : [];
}

export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PayPalShapeError(what);
  }
}
