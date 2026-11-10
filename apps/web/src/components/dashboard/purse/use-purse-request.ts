"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PurseFailure } from "@/server/purse-actions";
import type { PursePaymentView } from "@/server/purse";

export type PurseReply =
  | { readonly ok: true; readonly payment?: PursePaymentView; readonly outcome?: string }
  | { readonly ok: false; readonly reason: PurseFailure; readonly availableCents?: number };

/**
 * Sends one request to the Purse's boundary and keeps its state. The server
 * and the database decide everything; the reply's reason picks the words to
 * show, and a success reads the screen again.
 */
export function usePurseRequest() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ readonly reason: PurseFailure; readonly availableCents?: number } | null>(null);
  async function send(input: Record<string, unknown>): Promise<PurseReply> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/purse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const reply = parseReply(await response.json());
      if (reply.ok) router.refresh();
      else setError(reply.availableCents === undefined ? { reason: reply.reason } : { reason: reply.reason, availableCents: reply.availableCents });
      return reply;
    } catch {
      setError({ reason: "unavailable" });
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error, clear: () => setError(null) };
}

// The reply is read, not trusted: anything unexpected reads as unavailable.
function parseReply(value: unknown): PurseReply {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === false && typeof row.reason === "string") {
    const reason = row.reason as PurseFailure;
    return typeof row.availableCents === "number" ? { ok: false, reason, availableCents: row.availableCents } : { ok: false, reason };
  }
  if (row.ok !== true) return { ok: false, reason: "unavailable" };
  return row as PurseReply;
}
