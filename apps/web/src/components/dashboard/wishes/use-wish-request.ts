"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DraftedWish } from "@kin/agent";

import type { WishFailure } from "@/server/wishes";

export type WishReply =
  | { readonly ok: true; readonly id?: string; readonly state?: string; readonly wishes?: readonly DraftedWish[] }
  | { readonly ok: false; readonly reason: WishFailure };

/**
 * Sends one request to the wishes boundary and keeps its state. The server
 * checks everything; the reply's reason picks the words to show. A change
 * reads the screen again, so what the record now says is what is shown.
 */
export function useWishRequest() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WishFailure | null>(null);
  async function send(input: Record<string, unknown>, options: { readonly refresh?: boolean } = {}): Promise<WishReply> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/wishes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const reply = parseReply(await response.json());
      if (!reply.ok) setError(reply.reason);
      else if (options.refresh !== false) router.refresh();
      return reply;
    } catch {
      setError("unavailable");
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error, clear: () => setError(null) };
}

// The reply is read, not trusted: anything unexpected reads as unavailable.
export function parseReply(value: unknown): WishReply {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "unavailable" };
  const row = value as Record<string, unknown>;
  if (row.ok === false && typeof row.reason === "string") return { ok: false, reason: row.reason as WishFailure };
  if (row.ok !== true) return { ok: false, reason: "unavailable" };
  return row as WishReply;
}
