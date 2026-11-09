"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DraftForm, QuietFailure } from "@/server/quiet-shares";

export type QuietReply = { readonly ok: true; readonly state?: string; readonly id?: string; readonly approvalUrl?: string | null } | { readonly ok: false; readonly reason: QuietFailure };
export type WordsReply = { readonly ok: true; readonly draft: DraftForm; readonly reply: string | null; readonly heardAmount: boolean } | { readonly ok: false; readonly reason: QuietFailure };

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

// A reply is read, not trusted: anything unexpected reads as unavailable.
function parse<T extends { ok: boolean }>(value: unknown): T | { ok: false; reason: QuietFailure } {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === false && typeof row.reason === "string") return { ok: false, reason: row.reason as QuietFailure };
  return row.ok === true ? (value as T) : { ok: false, reason: "unavailable" };
}

/**
 * Carries one person's quiet-share requests to the server, in their own seat
 * or, in the demo's family layout, in the seat of the phone they are using.
 * The server checks everything; a success reads the screen again.
 */
export function useQuietShare(seat: string | null) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QuietFailure | null>(null);
  const withSeat = (input: Record<string, unknown>) => (seat === null ? input : { ...input, seat });

  async function run<T extends { ok: boolean }>(path: string, input: Record<string, unknown>, refresh: boolean): Promise<T | { ok: false; reason: QuietFailure }> {
    setPending(true);
    setError(null);
    try {
      const reply = parse<T>(await post(path, withSeat(input)));
      if (!reply.ok) setError((reply as { reason: QuietFailure }).reason);
      else if (refresh) router.refresh();
      return reply;
    } catch {
      setError("unavailable");
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    error,
    clearError: () => setError(null),
    send: (input: Record<string, unknown>) => run<Extract<QuietReply, { ok: true }>>("/api/quiet-shares", input, true) as Promise<QuietReply>,
    words: (input: Record<string, unknown>) => run<Extract<WordsReply, { ok: true }>>("/api/quiet-shares/words", input, false) as Promise<WordsReply>,
  };
}
