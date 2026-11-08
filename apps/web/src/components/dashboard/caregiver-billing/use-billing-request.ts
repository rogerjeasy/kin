"use client";

import type { FallbackReason } from "@kin/agent/provenance";
import { useState } from "react";
import type { BillingFailure, BillingResult } from "@/server/caregiver-billing";
import { parseBillingResponse } from "./billing-response";

/** Keeps recoverable request state separate from the rate and bill presentation. `url` is the route asked, the caregiver's own by default. */
export function useBillingRequest(errors: Record<BillingFailure, string>, url = "/api/caregiver-billing") {
  const [why, setWhy] = useState<FallbackReason | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingFailure | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  async function send(input: unknown): Promise<BillingResult> {
    setPending(true);
    setError(null);
    setBillId(null);
    setWhy(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload: unknown = await response.json();
      const result = parseBillingResponse(payload, errors);
      if (!result.ok) { setError(result.reason); setBillId(result.billId ?? null); setWhy(result.why ?? null); }
      return result;
    } catch {
      setError("unavailable");
      return { ok: false, reason: "unavailable" };
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error, billId, why };
}
