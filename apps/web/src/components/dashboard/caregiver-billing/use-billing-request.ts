"use client";

import { useState } from "react";
import type { BillingFailure, BillingResult } from "@/server/caregiver-billing";
import { parseBillingResponse } from "./billing-response";

/** Keeps recoverable request state separate from the rate and bill presentation. */
export function useBillingRequest(errors: Record<BillingFailure, string>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingFailure | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  async function send(input: unknown): Promise<BillingResult> {
    setPending(true);
    setError(null);
    setBillId(null);
    try {
      const response = await fetch("/api/caregiver-billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload: unknown = await response.json();
      const result = parseBillingResponse(payload, errors);
      if (!result.ok) { setError(result.reason); setBillId(result.billId ?? null); }
      return result;
    } catch {
      setError("unavailable");
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error, billId };
}
