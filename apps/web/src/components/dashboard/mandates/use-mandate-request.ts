"use client";

import type { MandateTerms } from "@kin/domain";
import { useState } from "react";

import type { MandateFailure } from "@/server/mandates";

export type MandateReply = { readonly ok: true; readonly terms?: MandateTerms; readonly aboveUsualCents?: number } | { readonly ok: false; readonly reason: MandateFailure };

/**
 * Sends one request to the mandate boundary and keeps its state. The server
 * checks everything; the reply's reason picks the words to show.
 */
export function useMandateRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MandateFailure | null>(null);
  async function send(input: unknown): Promise<MandateReply> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/mandates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const reply = parseReply(await response.json().catch(() => null));
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
function parseReply(value: unknown): MandateReply {
  const unavailable: MandateReply = { ok: false, reason: "unavailable" };
  if (typeof value !== "object" || value === null) return unavailable;
  const row = value as Record<string, unknown>;
  if (row["ok"] === false && typeof row["reason"] === "string") return { ok: false, reason: row["reason"] as MandateFailure };
  return row["ok"] === true ? (row as MandateReply) : unavailable;
}
