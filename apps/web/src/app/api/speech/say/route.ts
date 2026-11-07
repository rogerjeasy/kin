import { circleAudioRoute } from "@/server/circle-json-route";
import { sayLetter, sayClaim } from "@/server/letter-speech";
import { sayAnnouncement, sayBill, sayProposal } from "@/server/speech-actions";

import { speechContext } from "../context";

const MAX_SAY_BYTES = 32_768;

/**
 * Kin reads something aloud: a reviewed bill, a proposal, the answer it
 * heard, the circle's confirmed money events, a letter it read or a demand it
 * checked. Never text sent in: each is built here from the record, so the voice
 * cannot be made to say anything else.
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
    if (row.kind === "letter" && typeof row.documentId === "string" && Object.keys(row).every((key) => ["kind", "documentId", "locale"].includes(key))) {
      return sayLetter(speechContext(context), { documentId: row.documentId, locale });
    }
    if (row.kind === "claim" && typeof row.claimCheckId === "string" && Object.keys(row).every((key) => ["kind", "claimCheckId", "locale"].includes(key))) {
      return sayClaim(speechContext(context), { claimCheckId: row.claimCheckId, locale });
    }
    return { ok: false as const, reason: "invalid" as const };
  });
}
