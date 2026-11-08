"use client";

import { useState } from "react";

import type { ShiftFailure, ShiftResult } from "@/server/shifts";

/**
 * Sends one request to the shift boundary and keeps its state. The server
 * checks everything; the reply's reason picks the words to show. The reply is
 * read, not trusted: anything unexpected reads as unavailable.
 */
export function useShiftRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ShiftFailure | null>(null);
  async function send(input: unknown): Promise<ShiftResult> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/shifts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
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

function parseReply(value: unknown): ShiftResult {
  const unavailable: ShiftResult = { ok: false, reason: "unavailable" };
  if (typeof value !== "object" || value === null) return unavailable;
  const row = value as Record<string, unknown>;
  if (row["ok"] === false && typeof row["reason"] === "string") return { ok: false, reason: row["reason"] as ShiftFailure };
  return row["ok"] === true ? (row as ShiftResult) : unavailable;
}
