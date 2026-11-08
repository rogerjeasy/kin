"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { InvoiceFailure, InvoiceResult } from "@/server/invoice-requests";

/**
 * Sends one request to the invoice boundary and keeps its state. The server
 * checks everything; the reply's reason picks the words. A success refreshes
 * the screen, which reads the request's new state from the record.
 */
export function useInvoiceRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<InvoiceFailure | null>(null);
  const router = useRouter();
  async function send(input: Record<string, string>): Promise<InvoiceResult> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/invoice-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const reply = parseReply(await response.json());
      if (reply.ok) router.refresh();
      else setError(reply.reason);
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
function parseReply(value: unknown): InvoiceResult {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === true && typeof row.id === "string") return { ok: true, id: row.id };
  if (row.ok === false && typeof row.reason === "string") return { ok: false, reason: row.reason as InvoiceFailure };
  return { ok: false, reason: "unavailable" };
}
