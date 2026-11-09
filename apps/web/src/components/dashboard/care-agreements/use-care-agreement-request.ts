"use client";

import { useState } from "react";

import type { CareAgreementFailure, CareAgreementPreview } from "@/server/care-agreement";

export type CareAgreementReply =
  | { readonly ok: true; readonly preview?: CareAgreementPreview; readonly id?: string }
  | { readonly ok: false; readonly reason: CareAgreementFailure };

/**
 * Sends one request to the care agreement boundary and keeps its state. The
 * server checks everything; the reply's reason picks the words to show.
 */
export function useCareAgreementRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CareAgreementFailure | null>(null);
  async function send(input: unknown): Promise<CareAgreementReply> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/care-agreement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const reply = parseReply(await response.json());
      if (!reply.ok) setError(reply.reason);
      return reply;
    } catch {
      setError("unavailable");
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error };
}

// The reply is read, not trusted: anything unexpected reads as unavailable.
function parseReply(value: unknown): CareAgreementReply {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === false && typeof row.reason === "string") return { ok: false, reason: row.reason as CareAgreementFailure };
  if (row.ok !== true) return { ok: false, reason: "unavailable" };
  return row as CareAgreementReply;
}
