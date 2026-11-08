import { FALLBACK_REASONS, type FallbackReason, type Provenance } from "@kin/agent/provenance";

const isReason = (value: unknown): value is FallbackReason => FALLBACK_REASONS.some((reason) => reason === value);

/**
 * Checks that a value is a provenance, for anything that crossed a boundary:
 * a stored row, or a reply read in the browser. `null` for anything else, so
 * a screen shows no badge rather than a guessed one.
 */
export function parseProvenance(value: unknown): Provenance | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.source === "claude") return typeof row.model === "string" || row.model === null ? { source: "claude", model: row.model } : null;
  if ((row.source === "rules" || row.source === "template") && isReason(row.reason)) return { source: row.source, reason: row.reason };
  return null;
}

/** The provenance kept beside a document's reading. `null` for a reading stored before it was kept. */
export function storedProvenance(extraction: unknown): Provenance | null {
  return extraction !== null && typeof extraction === "object" && !Array.isArray(extraction) ? parseProvenance((extraction as Record<string, unknown>).provenance) : null;
}
