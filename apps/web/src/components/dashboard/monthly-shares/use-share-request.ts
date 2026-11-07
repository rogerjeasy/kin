"use client";

import { useState } from "react";

import type { ShareFailure } from "@/server/monthly-shares";

export type ShareAnswer = { readonly ok: true; readonly approvalUrl: string | null } | { readonly ok: false; readonly reason: ShareFailure };

/** Sends one request about the viewer's monthly share and keeps its state: pending, and the reason it was refused. */
export function useShareRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ShareFailure | null>(null);

  async function send(input: Record<string, string>): Promise<ShareAnswer> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/monthly-shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const answer = readAnswer(await response.json());
      if (!answer.ok) setError(answer.reason);
      return answer;
    } catch {
      setError("unavailable");
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }

  return { send, pending, error };
}

const REASONS: readonly ShareFailure[] = ["invalid", "amount", "unavailable", "paypal", "refused", "running", "move", "currency", "too_small", "too_large"];

/** What the server answered, or "unavailable" when it is not an answer Kin wrote. */
function readAnswer(payload: unknown): ShareAnswer {
  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "unavailable" };
  const { ok, reason, approvalUrl } = payload as Record<string, unknown>;
  if (ok === true) return { ok: true, approvalUrl: typeof approvalUrl === "string" ? approvalUrl : null };
  return { ok: false, reason: REASONS.find((each) => each === reason) ?? "unavailable" };
}
