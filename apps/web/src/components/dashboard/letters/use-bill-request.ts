"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BillPaymentFailure } from "@/server/bill-payments";

/**
 * Posts one bill operation to `/api/bills` and refreshes the page on success,
 * so the bill shows where it now stands. The server decides everything; the
 * answer is read only for whether it worked and, if not, which known reason.
 */
export function useBillRequest(errors: Record<BillPaymentFailure, string>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillPaymentFailure | null>(null);
  const router = useRouter();
  async function send(input: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload: unknown = await response.json();
      const row = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
      if (row?.ok === true) {
        router.refresh();
        return true;
      }
      const reason = typeof row?.reason === "string" && Object.hasOwn(errors, row.reason) ? (row.reason as BillPaymentFailure) : "unavailable";
      setError(reason);
      return false;
    } catch {
      setError("unavailable");
      return false;
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error };
}
