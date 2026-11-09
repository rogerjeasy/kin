import {
  AGENCY_KEY_HEADER,
  AGENCY_SIGNATURE_HEADER,
  agencySecret,
  authorize,
  hashAgencySecret,
  isAgencyKeyId,
  newAgencyKeyId,
  verifyAgencySignature,
} from "@kin/auth";
import { readAgencySigningKey } from "@kin/config";
import { OpenKinError, asPerson, createAgencyKey, receiveAgencyVisit, revokeAgencyKey, type CircleSnapshot, type Database } from "@kin/db";
import { parseVisitReport } from "@kin/domain";

import { readCappedText } from "../request-body";

/**
 * A home-care agency's software working with the circle (docs/architecture.md
 * section 13.5). The organizer creates a key and gives the agency its secret,
 * shown once. Each visit the agency reports is verified, kept with its raw
 * body, and shown to the family beside Kin's own shift. A report is evidence:
 * it pays nothing and changes no shift; the family still gives its word.
 */

/** The largest visit report read: one visit is a few hundred bytes. */
export const MAX_VISIT_BYTES = 16_384;

let signingKey: string | null | undefined;

/** The key agency secrets are derived from, or `null` when this deployment has none. Read on first use, never at build time. */
export function agencySigningKey(): string | null {
  signingKey ??= readAgencySigningKey(process.env);
  return signingKey;
}

export type AgencyContext = { readonly db: Database; readonly userId: string; readonly circle: CircleSnapshot; readonly signingKey: string | null };

export type AgencyKeyResult =
  | { readonly ok: true; readonly id: string; readonly keyId: string; readonly secret: string }
  | { readonly ok: true; readonly revoked: boolean }
  | { readonly ok: false; readonly reason: "refused" | "invalid" | "too_many_keys" | "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LABEL = /^[^<>{}\n\r]+$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The organizer creates or revokes an agency's key. */
export async function manageAgencyKey(context: AgencyContext, input: unknown): Promise<AgencyKeyResult> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "agency_key.manage").allowed) return { ok: false, reason: "refused" };
  if (!isRecord(input)) return { ok: false, reason: "invalid" };
  const circleId = circle.circle.id;
  try {
    if (input["operation"] === "create" && Object.keys(input).every((key) => key === "operation" || key === "label")) {
      const label = input["label"];
      if (typeof label !== "string" || !LABEL.test(label) || label.trim() === "" || label.trim().length > 80) return { ok: false, reason: "invalid" };
      if (context.signingKey === null) return { ok: false, reason: "unavailable" };
      const keyId = newAgencyKeyId();
      const secret = agencySecret(context.signingKey, keyId);
      const id = await asPerson(context.db, context.userId, (tx) => createAgencyKey(tx, { circleId, label: label.trim(), keyId, secretHash: hashAgencySecret(secret) }));
      return { ok: true, id, keyId, secret };
    }
    if (input["operation"] === "revoke" && Object.keys(input).every((key) => key === "operation" || key === "id") && typeof input["id"] === "string" && UUID.test(input["id"])) {
      const keyRowId = input["id"];
      return { ok: true, revoked: await asPerson(context.db, context.userId, (tx) => revokeAgencyKey(tx, { circleId, keyRowId })) };
    }
    return { ok: false, reason: "invalid" };
  } catch (error) {
    if (error instanceof OpenKinError) return { ok: false, reason: error.reason === "too_many_keys" ? "too_many_keys" : error.reason === "invalid" ? "invalid" : "refused" };
    throw error;
  }
}

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** What Kin tells the agency a report is, every time, so no integration can mistake it for a payment. */
const EVIDENCE_NOTE = "Kept as evidence beside the shift on the family's calendar. The family still confirms the visit in Kin; nothing is paid from a report.";

/**
 * `POST /api/v1/visits`: one visit, signed with the agency's key. The
 * signature is checked before anything is stored, then the raw body is kept,
 * then it is read: a body Kin cannot read is kept as refused and answered 422.
 */
export async function receiveVisit(request: Request, services: { readonly db: Database; readonly signingKey: string | null; readonly now?: () => Date }): Promise<Response> {
  const keyId = request.headers.get(AGENCY_KEY_HEADER);
  if (services.signingKey === null) return reply(503, { error: "unavailable", message: "Agency reporting is not switched on in this deployment." });
  if (!isAgencyKeyId(keyId)) return reply(401, { error: "unauthorized", message: `Send the agency key's ID in ${AGENCY_KEY_HEADER} and a signature in ${AGENCY_SIGNATURE_HEADER}.` });
  if (!/^application\/json\b/iu.test(request.headers.get("content-type") ?? "")) return reply(415, { error: "unsupported_media_type", message: "Send application/json." });
  const rawBody = await readCappedText(request, MAX_VISIT_BYTES);
  if (rawBody === null) return reply(413, { error: "too_large", message: "One visit per request, at most 16 KB." });
  if (rawBody === "") return reply(400, { error: "empty", message: "The body is empty." });
  const secret = agencySecret(services.signingKey, keyId);
  const verdict = verifyAgencySignature({ secret, header: request.headers.get(AGENCY_SIGNATURE_HEADER), rawBody, now: (services.now ?? (() => new Date()))() });
  if (!verdict.ok) return reply(401, { error: "unauthorized", message: verdict.reason === "stale" ? "The signature's timestamp is outside the five-minute window." : "The signature does not match this key and body." });

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    json = undefined;
  }
  const parsed = json === undefined ? ({ ok: false, reason: "shape" } as const) : parseVisitReport(json);
  try {
    const received = await receiveAgencyVisit(services.db, { keyId, secretHash: hashAgencySecret(secret), rawBody, parsed });
    if (received.state === "refused") return reply(422, { id: received.id, status: "refused", reason: parsed.ok ? "shape" : parsed.reason, message: "The body is not a visit Kin can read. It was kept as sent; see the OpenAPI document." });
    return reply(received.duplicate ? 200 : 201, { id: received.id, status: "received", duplicate: received.duplicate, caregiverMatched: received.caregiverMatched, note: EVIDENCE_NOTE });
  } catch (error) {
    if (!(error instanceof OpenKinError)) throw error;
    if (error.reason === "conflict") return reply(409, { error: "conflict", message: "This externalId was reported before with a different body." });
    if (error.reason === "too_many_reports") return reply(429, { error: "too_many_requests", message: "Too many visits from this key today." });
    return reply(401, { error: "unauthorized", message: "This key is not live." });
  }
}
