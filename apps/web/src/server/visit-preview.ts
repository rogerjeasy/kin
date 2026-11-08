import { authorize } from "@kin/auth";

import { readDescription, type BillingContext, type BillingResult } from "./caregiver-billing";

/**
 * A read-only preview of how Kin reads a caregiver's description of visits,
 * for a demo circle's family to try without switching to the caregiver. It
 * runs the same reading as the caregiver's own form and returns what it found,
 * and nothing more: no bill is made, nothing is stored, and the caregiver's
 * rate is never part of it. It uses the same per-person and per-server limits.
 * Those who may hold up a letter may try it, and only in a demo circle.
 */
export async function previewVisits(context: BillingContext, input: unknown): Promise<BillingResult> {
  if (!authorize({ role: context.circle.viewer.role, status: "active" }, "letter.read").allowed || !context.circle.circle.demo) return { ok: false, reason: "refused" };
  const row = input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!row || Object.keys(row).some((key) => key !== "description") || typeof row.description !== "string") return { ok: false, reason: "invalid" };
  return readDescription(context, row.description);
}
