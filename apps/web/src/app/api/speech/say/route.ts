import { circleAudioRoute } from "@/server/circle-json-route";
import { sayAnnouncement, sayBill, sayProposal } from "@/server/speech-actions";

import { speechContext } from "../context";

const MAX_SAY_BYTES = 32_768;

/**
 * Kin reads something aloud: a reviewed bill, a proposal, the answer it
 * heard, or the circle's confirmed money events. Never text sent in: each is built here from the record, so the
 * voice cannot be made to say anything else.
 */
export function POST(request: Request): Promise<Response> {
  return circleAudioRoute(request, { maxBytes: MAX_SAY_BYTES, label: "speech.say" }, async (context, input) => {
    const row = input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const locale = typeof row.locale === "string" ? row.locale : "";
    if (row.kind === "bill" && Object.keys(row).every((key) => ["kind", "details", "locale"].includes(key))) return sayBill(speechContext(context), { details: row.details, locale });
    if (row.kind === "announcement" && Object.keys(row).every((key) => ["kind", "every", "locale"].includes(key))) return sayAnnouncement(speechContext(context), { every: row.every, locale });
    if (row.kind === "proposal" && typeof row.proposalId === "string" && Object.keys(row).every((key) => ["kind", "proposalId", "decision", "locale"].includes(key))) {
      const decision = row.decision === "approve" || row.decision === "reject" ? row.decision : null;
      return sayProposal(speechContext(context), { proposalId: row.proposalId, locale, decision });
    }
    return { ok: false as const, reason: "invalid" as const };
  });
}
