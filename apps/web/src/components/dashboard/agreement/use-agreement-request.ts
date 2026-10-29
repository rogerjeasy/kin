"use client";

import type { AgreementChange, AgreementTerms } from "@kin/domain";
import { useState } from "react";

import type { AgreementFailure } from "@/server/agreement";

export type AgreementErrors = Record<AgreementFailure, string>;
export type AgreementReply =
  | { readonly ok: true; readonly terms?: AgreementTerms; readonly changes?: readonly AgreementChange[] }
  | { readonly ok: false; readonly reason: AgreementFailure };

/**
 * Sends one request to the agreement boundary and keeps its state. The
 * server checks everything; the reply's reason picks the words to show.
 */
export function useAgreementRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AgreementFailure | null>(null);
  async function send(input: unknown): Promise<AgreementReply> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/agreement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
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
function parseReply(value: unknown): AgreementReply {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === false && typeof row.reason === "string") return { ok: false, reason: row.reason as AgreementFailure };
  if (row.ok !== true) return { ok: false, reason: "unavailable" };
  if (row.changes !== undefined && !Array.isArray(row.changes)) return { ok: false, reason: "unavailable" };
  return row as AgreementReply;
}

