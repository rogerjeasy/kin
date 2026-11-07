"use client";

import { useState } from "react";

import type { SettlementFailure, SettlementResult } from "@/server/settlement";

export type SettlementErrors = Record<SettlementFailure, string>;

/**
 * Sends one request to the receipts and settlement boundary and keeps its
 * state. The server checks everything; the reply's reason picks the words.
 */
export function useSettlementRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SettlementFailure | null>(null);
  async function send(input: unknown): Promise<SettlementResult> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/settlement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
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
function parseReply(value: unknown): SettlementResult {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === true && typeof row.id === "string") return { ok: true, id: row.id };
  if (row.ok === false && typeof row.reason === "string") return { ok: false, reason: row.reason as SettlementFailure };
  return { ok: false, reason: "unavailable" };
}
